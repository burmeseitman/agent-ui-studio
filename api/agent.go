package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"agentui-daemon/adapter"
	"agentui-daemon/tools"
)

// maxToolIterations bounds the automatic tool loop so a model that keeps
// requesting tools cannot spin forever.
//
// A real coding task — orient, read, edit, build, fix — needs far more rounds
// than a single question does, so the client can raise this up to the ceiling.
const (
	defaultToolIterations = 8
	maxToolIterations     = 40
)

func resolveIterations(requested int) int {
	if requested <= 0 {
		return defaultToolIterations
	}
	if requested > maxToolIterations {
		return maxToolIterations
	}
	return requested
}

// toolEvent is an out-of-band SSE payload describing tool activity. It is
// distinguishable from model chunks by its object field.
type toolEvent struct {
	Object     string `json:"object"`
	ToolCallID string `json:"tool_call_id"`
	Name       string `json:"name"`
	Arguments  string `json:"arguments"`
	Output     string `json:"output,omitempty"`
	Error      string `json:"error,omitempty"`
	Iteration  int    `json:"iteration"`
}

const (
	objectToolStarted = "agentui.tool_started"
	objectToolResult  = "agentui.tool_result"
	objectTextCalls   = "agentui.text_tool_calls"
	objectNotice      = "agentui.notice"
)

// noticeEvent surfaces a condition the user should know about but which is not
// an error, such as a model that cannot use the tools it was offered.
type noticeEvent struct {
	Object  string `json:"object"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

// textCallRecovery tells the client that what streamed as message text was in
// fact a tool call, along with the prose left once the JSON is removed.
type textCallRecovery struct {
	Object    string             `json:"object"`
	Content   string             `json:"content"`
	ToolCalls []adapter.ToolCall `json:"tool_calls"`
}

// resolveTools maps client-requested tool names onto registered schemas.
// Unknown names are ignored rather than trusted, and an empty list disables
// tool calling entirely for the request.
func resolveTools(names []string) []tools.ToolDefinition {
	if len(names) == 0 {
		return nil
	}
	wanted := make(map[string]bool, len(names))
	for _, n := range names {
		wanted[strings.TrimSpace(n)] = true
	}

	var out []tools.ToolDefinition
	for _, def := range tools.AllTools() {
		if wanted[def.Function.Name] {
			out = append(out, def)
		}
	}
	return out
}

// nameSet builds a lookup set, returning nil for an empty input so callers can
// distinguish "no restriction" from "restricted to nothing".
func nameSet(names []string) map[string]bool {
	if len(names) == 0 {
		return nil
	}
	set := make(map[string]bool, len(names))
	for _, n := range names {
		set[strings.TrimSpace(n)] = true
	}
	return set
}

// mayRunUnattended reports whether every call in a turn is cleared for automatic
// execution.
//
// The check is all-or-nothing per turn: if a model asks for a read and a write
// together, the whole batch goes to the user rather than half-executing and
// leaving the conversation in a split state.
func mayRunUnattended(calls []adapter.ToolCall, offered, autoApproved map[string]bool) bool {
	for _, call := range calls {
		name := strings.TrimSpace(call.Function.Name)
		// A tool that was never offered must never run, whatever the engine says.
		if offered != nil && !offered[name] {
			return false
		}
		if autoApproved != nil && !autoApproved[name] {
			return false
		}
	}
	return true
}

// runAgentLoop streams a completion and, in auto mode, executes any requested
// tools and continues the conversation until the model stops asking for tools.
//
// In manual mode — or when a turn requests anything outside AutoApproveTools —
// the tool calls are streamed to the client and the loop ends: approval and
// execution belong to the client from there.
func (s *Server) runAgentLoop(
	ctx context.Context,
	req *adapter.ChatCompletionRequest,
	emit func(v any) error,
) error {
	autoMode := strings.EqualFold(req.ToolMode, adapter.ToolModeAuto)

	offered := make(map[string]bool, len(req.Tools))
	for _, def := range req.Tools {
		offered[def.Function.Name] = true
	}
	autoApproved := nameSet(req.AutoApproveTools)

	messages := req.Messages
	iterations := resolveIterations(req.MaxToolIterations)
	warnedNoTools := false

	for iteration := 0; iteration < iterations; iteration++ {
		turn := *req
		turn.Messages = messages

		result, err := s.router.Stream(ctx, &turn, func(chunk *adapter.ChatCompletionChunk) error {
			return emit(chunk)
		})
		if err != nil {
			return err
		}

		if result.ToolsUnsupported && !warnedNoTools {
			warnedNoTools = true
			slog.Warn("model does not support tools; answered without them", "model", req.Model)
			if err := emit(&noticeEvent{
				Object: objectNotice,
				Level:  "warning",
				Message: fmt.Sprintf(
					"%s cannot use tools, so it answered without them. Pick a tool-capable model such as qwen2.5-coder for agent work.",
					req.Model),
			}); err != nil {
				return err
			}
		}

		// Small local models frequently write a well-formed tool call into the
		// message text instead of using the native channel. The intent is
		// unambiguous, so recover it rather than letting the agent stall.
		recoveredFromText := false
		if len(result.ToolCalls) == 0 && len(offered) > 0 {
			if recovered := adapter.ParseTextToolCalls(result.Content, func(name string) bool {
				return offered[name]
			}); len(recovered) > 0 {
				slog.Info("recovered tool calls from message text",
					"count", len(recovered), "model", req.Model)
				result.ToolCalls = recovered
				result.Content = adapter.StripToolCallText(result.Content, func(name string) bool {
					return offered[name]
				})
				recoveredFromText = true

				// Tell the client so it can replace the raw JSON it just streamed.
				if err := emit(&textCallRecovery{
					Object:    objectTextCalls,
					Content:   result.Content,
					ToolCalls: recovered,
				}); err != nil {
					return err
				}
			}
		}
		_ = recoveredFromText

		if len(result.ToolCalls) == 0 || !autoMode {
			return nil
		}

		if !mayRunUnattended(result.ToolCalls, offered, autoApproved) {
			// Hand the batch to the user instead of running it.
			return nil
		}

		// Record what the model asked for, then execute and feed results back.
		messages = append(messages, adapter.ChatMessage{
			Role:      "assistant",
			Content:   result.Content,
			ToolCalls: result.ToolCalls,
		})

		for _, call := range result.ToolCalls {
			if err := ctx.Err(); err != nil {
				return err
			}

			if err := emit(&toolEvent{
				Object:     objectToolStarted,
				ToolCallID: call.ID,
				Name:       call.Function.Name,
				Arguments:  call.Function.Arguments,
				Iteration:  iteration,
			}); err != nil {
				return err
			}

			output, execErr := executeToolCall(ctx, call)

			event := &toolEvent{
				Object:     objectToolResult,
				ToolCallID: call.ID,
				Name:       call.Function.Name,
				Arguments:  call.Function.Arguments,
				Output:     output,
				Iteration:  iteration,
			}
			content := output
			if execErr != nil {
				event.Error = execErr.Error()
				content = "ERROR: " + execErr.Error()
				slog.Warn("tool execution failed", "tool", call.Function.Name, "error", execErr)
			}
			if err := emit(event); err != nil {
				return err
			}

			messages = append(messages, adapter.ChatMessage{
				Role:       "tool",
				Name:       call.Function.Name,
				ToolCallID: call.ID,
				Content:    content,
			})
		}
	}

	return fmt.Errorf(
		"stopped after %d tool rounds without a final answer. Ask the model to continue if it was making progress",
		iterations)
}

// executeToolCall validates and runs a single model-requested tool call.
func executeToolCall(ctx context.Context, call adapter.ToolCall) (string, error) {
	name := strings.TrimSpace(call.Function.Name)
	if !tools.IsKnownTool(name) {
		return "", fmt.Errorf("unknown tool: %q", name)
	}

	args := strings.TrimSpace(call.Function.Arguments)
	if args == "" {
		args = "{}"
	}
	if !json.Valid([]byte(args)) {
		return "", fmt.Errorf("tool %q was called with malformed JSON arguments", name)
	}

	return tools.ExecuteToolContext(ctx, name, args)
}
