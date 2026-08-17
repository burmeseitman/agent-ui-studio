package adapter

import "agentui-daemon/tools"

// ToolCallFunction is the function name/arguments pair of a tool call.
// Arguments is always a JSON-encoded string, matching the OpenAI wire format.
type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolCall is a single tool invocation requested by the model. During streaming
// the fields arrive incrementally and are accumulated by Index.
type ToolCall struct {
	Index    int              `json:"index"`
	ID       string           `json:"id,omitempty"`
	Type     string           `json:"type,omitempty"`
	Function ToolCallFunction `json:"function"`
}

// ChatMessage represents a single message in a conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	// Name and ToolCallID carry tool results back to the model (role="tool").
	Name       string `json:"name,omitempty"`
	ToolCallID string `json:"tool_call_id,omitempty"`
	// ToolCalls is set on assistant messages that requested tools.
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// Tool execution modes accepted on the wire.
const (
	// ToolModeManual streams tool calls to the client and stops. The client is
	// responsible for obtaining user approval, executing, and resubmitting.
	ToolModeManual = "manual"
	// ToolModeAuto executes tool calls server-side and continues the loop.
	ToolModeAuto = "auto"
)

// ChatCompletionRequest is the unified request payload for chat completion.
type ChatCompletionRequest struct {
	Engine      string        `json:"engine,omitempty"`
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   *int          `json:"max_tokens,omitempty"`
	Stream      *bool         `json:"stream,omitempty"`

	// EnabledTools names the tools the client wants exposed to the model. The
	// server resolves them to schemas; clients cannot inject arbitrary schemas.
	EnabledTools []string `json:"enabled_tools,omitempty"`
	// ToolMode selects manual (default) or automatic tool execution.
	ToolMode string `json:"tool_mode,omitempty"`
	// MaxToolIterations raises the server-side tool loop budget for agentic
	// work. Zero uses the default; the server clamps the upper bound.
	MaxToolIterations int `json:"max_tool_iterations,omitempty"`
	// AutoApproveTools narrows automatic execution to specific tools. In auto
	// mode an omitted list means every enabled tool may run unattended; a
	// present list means anything outside it pauses for user approval.
	AutoApproveTools []string `json:"auto_approve_tools,omitempty"`

	// Tools is populated server-side from EnabledTools and is never read from
	// the request body.
	Tools []tools.ToolDefinition `json:"-"`
}

// ChunkDelta holds the incremental content generated in a stream chunk.
type ChunkDelta struct {
	Role      string     `json:"role,omitempty"`
	Content   string     `json:"content,omitempty"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// ChunkChoice represents a single choice within a stream chunk.
type ChunkChoice struct {
	Index        int        `json:"index"`
	Delta        ChunkDelta `json:"delta"`
	FinishReason *string    `json:"finish_reason"`
}

// Usage reports real token accounting from the engine, when it provides any.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	// EvalDurationMs is the engine-reported generation time, used for an
	// accurate tokens/sec figure that excludes prompt processing.
	EvalDurationMs int64 `json:"eval_duration_ms,omitempty"`
}

// ChatCompletionChunk is the unified SSE chunk returned to clients.
type ChatCompletionChunk struct {
	ID      string        `json:"id"`
	Object  string        `json:"object"`
	Created int64         `json:"created"`
	Model   string        `json:"model"`
	Choices []ChunkChoice `json:"choices"`
	Usage   *Usage        `json:"usage,omitempty"`
}

// ChunkHandler is a callback invoked for each generated stream chunk.
type ChunkHandler func(chunk *ChatCompletionChunk) error

// StreamResult summarises what a completed stream produced, so callers can
// decide whether a tool round-trip is needed.
type StreamResult struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
	Usage        *Usage
	// ToolsUnsupported is set when the engine refused the request because the
	// model cannot do tool calling, and it was retried as a plain chat.
	ToolsUnsupported bool
}

// ToolCallAccumulator reassembles tool calls that arrive as indexed deltas.
type ToolCallAccumulator struct {
	byIndex map[int]*ToolCall
	order   []int
}

// NewToolCallAccumulator returns an empty accumulator.
func NewToolCallAccumulator() *ToolCallAccumulator {
	return &ToolCallAccumulator{byIndex: make(map[int]*ToolCall)}
}

// Add merges a delta into the accumulated set.
func (a *ToolCallAccumulator) Add(delta ToolCall) {
	existing, ok := a.byIndex[delta.Index]
	if !ok {
		clone := delta
		a.byIndex[delta.Index] = &clone
		a.order = append(a.order, delta.Index)
		return
	}
	if delta.ID != "" {
		existing.ID = delta.ID
	}
	if delta.Type != "" {
		existing.Type = delta.Type
	}
	if delta.Function.Name != "" {
		existing.Function.Name = delta.Function.Name
	}
	// Arguments stream as string fragments and must be concatenated.
	existing.Function.Arguments += delta.Function.Arguments
}

// Calls returns the accumulated tool calls in arrival order.
func (a *ToolCallAccumulator) Calls() []ToolCall {
	out := make([]ToolCall, 0, len(a.order))
	for _, idx := range a.order {
		call := *a.byIndex[idx]
		if call.Type == "" {
			call.Type = "function"
		}
		out = append(out, call)
	}
	return out
}

// Len reports how many distinct tool calls have been seen.
func (a *ToolCallAccumulator) Len() int { return len(a.order) }
