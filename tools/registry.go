package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

var (
	allToolsCache []ToolDefinition
	allToolsOnce  sync.Once
)

// AllTools returns all available tools with full JSON schema specifications.
func AllTools() []ToolDefinition {
	allToolsOnce.Do(func() {
		allToolsCache = []ToolDefinition{
			// Developer Tools
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "execute_command",
					Description: "Run a single read-only inspection command in the workspace. Executed directly without a shell: pipes, redirection, command substitution and chaining are NOT supported. Only these binaries are permitted: " + strings.Join(AllowedCommandNames(), ", ") + ". git and go accept read-only subcommands only.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"command": {
								Type:        "string",
								Description: "A single command with its arguments (e.g. 'git status', 'ls -la', 'go vet ./...'). No shell syntax.",
							},
						},
						Required: []string{"command"},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "read_file",
					Description: "Read the full contents of a file in the workspace.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"path": {
								Type:        "string",
								Description: "Path to the file to read (e.g. 'main.go', 'web/src/App.tsx').",
							},
						},
						Required: []string{"path"},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "write_file",
					Description: "Write or update code content in a target file in the workspace.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"path": {
								Type:        "string",
								Description: "The target file path to create or write to.",
							},
							"content": {
								Type:        "string",
								Description: "The full file content to write.",
							},
						},
						Required: []string{"path", "content"},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "list_dir",
					Description: "List files and subdirectories in a directory path.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"path": {
								Type:        "string",
								Description: "Directory path to list (default: '.').",
							},
						},
					},
				},
			},

			// Content Writer & Researcher Tools
			{
				Type:     "function",
				Category: "writer",
				Function: FunctionDefinition{
					Name:        "fetch_url",
					Description: "Fetch and read the text content of a public web page or article for research or summary.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"url": {
								Type:        "string",
								Description: "The public HTTP/HTTPS URL to fetch and read.",
							},
						},
						Required: []string{"url"},
					},
				},
			},
			{
				Type:     "function",
				Category: "writer",
				Function: FunctionDefinition{
					Name:        "analyze_readability",
					Description: "Analyze the word count, sentence count, reading time, and reading level of a given text.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"text": {
								Type:        "string",
								Description: "The text content to analyze.",
							},
						},
						Required: []string{"text"},
					},
				},
			},
		}
	})

	result := make([]ToolDefinition, len(allToolsCache))
	copy(result, allToolsCache)
	return result
}

// GetToolsForProfession returns active tool definitions for a selected profession.
func GetToolsForProfession(profession string, customTools []string) []ToolDefinition {
	all := AllTools()
	prof := strings.ToLower(strings.TrimSpace(profession))

	switch prof {
	case "developer", "dev", "engineer":
		var devTools []ToolDefinition
		for _, t := range all {
			if t.Category == "developer" || t.Function.Name == "fetch_url" {
				devTools = append(devTools, t)
			}
		}
		return devTools

	case "writer", "copywriter", "content_writer":
		var writerTools []ToolDefinition
		for _, t := range all {
			if t.Category == "writer" || t.Function.Name == "read_file" {
				writerTools = append(writerTools, t)
			}
		}
		return writerTools

	case "researcher", "analyst":
		var researchTools []ToolDefinition
		for _, t := range all {
			if t.Function.Name == "fetch_url" || t.Function.Name == "read_file" || t.Function.Name == "analyze_readability" {
				researchTools = append(researchTools, t)
			}
		}
		return researchTools

	case "custom":
		if len(customTools) == 0 {
			return all
		}
		var selected []ToolDefinition
		customMap := make(map[string]bool)
		for _, c := range customTools {
			customMap[c] = true
		}
		for _, t := range all {
			if customMap[t.Function.Name] {
				selected = append(selected, t)
			}
		}
		return selected

	default:
		return all
	}
}

// ReadOnlyTools are tools with no side effects outside the daemon process.
// Tools absent from this set mutate the workspace and always require explicit
// user approval before execution.
var ReadOnlyTools = map[string]bool{
	"read_file":           true,
	"list_dir":            true,
	"analyze_readability": true,
	"fetch_url":           true,
	"execute_command":     true, // the command policy itself restricts this to read-only binaries
}

// IsKnownTool reports whether name refers to a registered tool.
func IsKnownTool(name string) bool {
	for _, t := range AllTools() {
		if t.Function.Name == name {
			return true
		}
	}
	return false
}

// ExecuteTool parses JSON arguments and runs the requested tool.
//
// Deprecated: prefer ExecuteToolContext so callers can cancel long-running
// commands and network fetches. Retained for tests and simple callers.
func ExecuteTool(name string, argumentsJSON string) (string, error) {
	return ExecuteToolContext(context.Background(), name, argumentsJSON)
}

// ExecuteToolContext parses JSON arguments and runs the requested tool, honouring
// cancellation from ctx.
func ExecuteToolContext(ctx context.Context, name string, argumentsJSON string) (string, error) {
	name = strings.TrimSpace(name)

	var args map[string]interface{}
	if argumentsJSON != "" {
		if err := json.Unmarshal([]byte(argumentsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid tool arguments JSON: %w", err)
		}
	} else {
		args = make(map[string]interface{})
	}

	getStringArg := func(key string) string {
		if val, ok := args[key]; ok {
			if s, ok := val.(string); ok {
				return s
			}
		}
		return ""
	}

	switch name {
	case "execute_command":
		cmd := getStringArg("command")
		if cmd == "" {
			return "", fmt.Errorf("missing 'command' argument")
		}
		return ExecuteCommand(ctx, cmd)

	case "read_file":
		path := getStringArg("path")
		if path == "" {
			return "", fmt.Errorf("missing 'path' argument")
		}
		return ReadFile(path)

	case "write_file":
		path := getStringArg("path")
		content := getStringArg("content")
		if path == "" {
			return "", fmt.Errorf("missing 'path' argument")
		}
		return WriteFile(path, content)

	case "list_dir":
		path := getStringArg("path")
		return ListDir(path)

	case "fetch_url":
		url := getStringArg("url")
		if url == "" {
			return "", fmt.Errorf("missing 'url' argument")
		}
		return FetchURL(ctx, url)

	case "analyze_readability":
		text := getStringArg("text")
		if text == "" {
			return "", fmt.Errorf("missing 'text' argument")
		}
		return AnalyzeReadability(text)

	default:
		return "", fmt.Errorf("unknown tool: %q", name)
	}
}
