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

	"agentui-daemon/tools"
)

type openAIStreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

type openAIChatRequest struct {
	Model         string                 `json:"model"`
	Messages      []ChatMessage          `json:"messages"`
	Stream        bool                   `json:"stream"`
	Temperature   *float64               `json:"temperature,omitempty"`
	MaxTokens     *int                   `json:"max_tokens,omitempty"`
	Tools         []tools.ToolDefinition `json:"tools,omitempty"`
	ToolChoice    string                 `json:"tool_choice,omitempty"`
	StreamOptions *openAIStreamOptions   `json:"stream_options,omitempty"`
}

// StreamOpenAICompat sends a streaming chat request to an OpenAI-compatible endpoint (LM Studio/vLLM)
// and invokes the handler for each chunk.
func StreamOpenAICompat(ctx context.Context, client *http.Client, baseURL string, req *ChatCompletionRequest, handler ChunkHandler) (*StreamResult, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	endpoint := fmt.Sprintf("%s/v1/chat/completions", baseURL)

	openAIReq := openAIChatRequest{
		Model:         req.Model,
		Messages:      req.Messages,
		Stream:        true,
		Temperature:   req.Temperature,
		MaxTokens:     req.MaxTokens,
		Tools:         req.Tools,
		StreamOptions: &openAIStreamOptions{IncludeUsage: true},
	}
	if len(req.Tools) > 0 {
		openAIReq.ToolChoice = "auto"
	}

	payloadBytes, err := json.Marshal(openAIReq)
	if err != nil {
		return nil, fmt.Errorf("failed to encode openai request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("openai compat connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		return nil, fmt.Errorf("openai compat error (status %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	result := &StreamResult{}
	acc := NewToolCallAccumulator()
	var content strings.Builder

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		if !strings.HasPrefix(line, "data:") {
			continue
		}

		dataContent := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if dataContent == "[DONE]" {
			break
		}

		var chunk ChatCompletionChunk
		if err := json.Unmarshal([]byte(dataContent), &chunk); err != nil {
			slog.Warn("failed to parse chunk", "error", err)
			continue
		}

		for _, choice := range chunk.Choices {
			content.WriteString(choice.Delta.Content)
			for _, tc := range choice.Delta.ToolCalls {
				acc.Add(tc)
			}
			if choice.FinishReason != nil && *choice.FinishReason != "" {
				result.FinishReason = *choice.FinishReason
			}
		}
		if chunk.Usage != nil {
			result.Usage = chunk.Usage
		}

		if err := handler(&chunk); err != nil {
			return nil, err
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	result.Content = content.String()
	result.ToolCalls = acc.Calls()
	if result.FinishReason == "" && acc.Len() > 0 {
		result.FinishReason = "tool_calls"
	}
	return result, nil
}
