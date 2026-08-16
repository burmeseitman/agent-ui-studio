package adapter

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"agentui-daemon/tools"
)

type ollamaChatRequest struct {
	Model    string                 `json:"model"`
	Messages []ollamaMessage        `json:"messages"`
	Stream   bool                   `json:"stream"`
	Tools    []tools.ToolDefinition `json:"tools,omitempty"`
	Options  *ollamaChatOptions     `json:"options,omitempty"`
}

type ollamaChatOptions struct {
	Temperature *float64 `json:"temperature,omitempty"`
	NumPredict  int      `json:"num_predict,omitempty"`
}

// ollamaMessage mirrors ChatMessage but encodes tool call arguments as JSON
// objects, which is what Ollama expects and emits.
type ollamaMessage struct {
	Role      string           `json:"role"`
	Content   string           `json:"content"`
	ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
	ToolName  string           `json:"tool_name,omitempty"`
}

type ollamaToolCall struct {
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

type ollamaStreamChunk struct {
	Model     string        `json:"model"`
	CreatedAt time.Time     `json:"created_at"`
	Message   ollamaMessage `json:"message"`
	Done      bool          `json:"done"`

	DoneReason      string `json:"done_reason"`
	PromptEvalCount int    `json:"prompt_eval_count"`
	EvalCount       int    `json:"eval_count"`
	EvalDuration    int64  `json:"eval_duration"`
}

// toOllamaMessages converts unified messages into Ollama's wire shape.
func toOllamaMessages(messages []ChatMessage) []ollamaMessage {
	out := make([]ollamaMessage, 0, len(messages))
	for _, m := range messages {
		om := ollamaMessage{Role: m.Role, Content: m.Content}
		if m.Role == "tool" {
			om.ToolName = m.Name
		}
		for _, tc := range m.ToolCalls {
			var oc ollamaToolCall
			oc.Function.Name = tc.Function.Name
			args := strings.TrimSpace(tc.Function.Arguments)
			if args == "" || !json.Valid([]byte(args)) {
				args = "{}"
			}
			oc.Function.Arguments = json.RawMessage(args)
			om.ToolCalls = append(om.ToolCalls, oc)
		}
		out = append(out, om)
	}
	return out
}

// StreamOllama sends a streaming chat request to Ollama (/api/chat) and translates NDJSON chunks.
func StreamOllama(ctx context.Context, client *http.Client, baseURL string, req *ChatCompletionRequest, handler ChunkHandler) (*StreamResult, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	endpoint := fmt.Sprintf("%s/api/chat", baseURL)

	ollamaReq := ollamaChatRequest{
		Model:    req.Model,
		Messages: toOllamaMessages(req.Messages),
		Stream:   true,
		Tools:    req.Tools,
	}

	if req.Temperature != nil || req.MaxTokens != nil {
		opts := &ollamaChatOptions{}
		if req.Temperature != nil {
			opts.Temperature = req.Temperature
		}
		if req.MaxTokens != nil {
			opts.NumPredict = *req.MaxTokens
		}
		ollamaReq.Options = opts
	}

	payloadBytes, err := json.Marshal(ollamaReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode ollama request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		return nil, fmt.Errorf("ollama error (status %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	scanner := bufio.NewScanner(resp.Body)
	// Buffer up to 1MB per chunk line
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	reqID := fmt.Sprintf("chatcmpl-ollama-%d", time.Now().UnixNano())
	created := time.Now().Unix()

	result := &StreamResult{}
	acc := NewToolCallAccumulator()
	var content strings.Builder

	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}

		var chunk ollamaStreamChunk
		if err := json.Unmarshal(line, &chunk); err != nil {
			slog.Warn("failed to parse chunk", "error", err)
			continue
		}

		content.WriteString(chunk.Message.Content)

		// Ollama emits complete tool calls in a single message, without ids.
		var deltaCalls []ToolCall
		for _, oc := range chunk.Message.ToolCalls {
			args := string(oc.Function.Arguments)
			if strings.TrimSpace(args) == "" {
				args = "{}"
			}
			call := ToolCall{
				Index:    acc.Len() + len(deltaCalls),
				ID:       fmt.Sprintf("call_%s_%d", reqID[len(reqID)-8:], acc.Len()+len(deltaCalls)),
				Type:     "function",
				Function: ToolCallFunction{Name: oc.Function.Name, Arguments: args},
			}
			deltaCalls = append(deltaCalls, call)
		}
		for _, call := range deltaCalls {
			acc.Add(call)
		}

		var finishReason *string
		var usage *Usage
		if chunk.Done {
			reason := chunk.DoneReason
			if reason == "" {
				reason = "stop"
			}
			if acc.Len() > 0 {
				reason = "tool_calls"
			}
			finishReason = &reason
			result.FinishReason = reason

			usage = &Usage{
				PromptTokens:     chunk.PromptEvalCount,
				CompletionTokens: chunk.EvalCount,
				TotalTokens:      chunk.PromptEvalCount + chunk.EvalCount,
				EvalDurationMs:   chunk.EvalDuration / int64(time.Millisecond),
			}
			result.Usage = usage
		}

		unifiedChunk := &ChatCompletionChunk{
			ID:      reqID,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   req.Model,
			Choices: []ChunkChoice{
				{
					Index: 0,
					Delta: ChunkDelta{
						Role:      chunk.Message.Role,
						Content:   chunk.Message.Content,
						ToolCalls: deltaCalls,
					},
					FinishReason: finishReason,
				},
			},
			Usage: usage,
		}

		if err := handler(unifiedChunk); err != nil {
			return nil, err
		}

		if chunk.Done {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	result.Content = content.String()
	result.ToolCalls = acc.Calls()
	return result, nil
}
