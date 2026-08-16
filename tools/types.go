package tools

// ToolParameterProperty represents JSON Schema property definition.
type ToolParameterProperty struct {
	Type        string   `json:"type"`
	Description string   `json:"description,omitempty"`
	Enum        []string `json:"enum,omitempty"`
}

// ToolParametersSchema defines the JSON schema for tool arguments.
type ToolParametersSchema struct {
	Type       string                           `json:"type"`
	Properties map[string]ToolParameterProperty `json:"properties"`
	Required   []string                         `json:"required,omitempty"`
}

// FunctionDefinition represents the function schema metadata for LLMs.
type FunctionDefinition struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Parameters  ToolParametersSchema `json:"parameters"`
}

// ToolDefinition represents standard OpenAI/Ollama tool specifications.
type ToolDefinition struct {
	Type     string             `json:"type"`
	Category string             `json:"category"`
	Function FunctionDefinition `json:"function"`
}

// ToolCall represents a tool call requested by the LLM.
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// ToolResult represents the output from executing a tool.
type ToolResult struct {
	ToolCallID string `json:"tool_call_id,omitempty"`
	Name       string `json:"name"`
	Output     string `json:"output"`
	Error      string `json:"error,omitempty"`
}
