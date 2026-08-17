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
					Description: "Create a new file, or completely overwrite an existing one. Parent directories are created automatically. To change part of an existing file use edit_file instead — overwriting requires reproducing the whole file and loses anything you omit.",
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

			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "edit_file",
					Description: "Change part of an existing file by replacing an exact snippet. Prefer this over write_file for any edit: it leaves the rest of the file untouched. Read the file first and copy old_string exactly, including indentation. old_string must match exactly once unless replace_all is true.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"path": {
								Type:        "string",
								Description: "File to modify.",
							},
							"old_string": {
								Type:        "string",
								Description: "Exact text to replace, with enough surrounding context to be unique.",
							},
							"new_string": {
								Type:        "string",
								Description: "Replacement text.",
							},
							"replace_all": {
								Type:        "boolean",
								Description: "Replace every occurrence instead of requiring a unique match.",
							},
						},
						Required: []string{"path", "old_string", "new_string"},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "delete_file",
					Description: "Delete a file, or an empty directory, inside the workspace.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"path": {Type: "string", Description: "Path to delete."},
						},
						Required: []string{"path"},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "move_file",
					Description: "Rename or move a file or directory within the workspace.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"from": {Type: "string", Description: "Existing path."},
							"to":   {Type: "string", Description: "New path. Parent directories are created."},
						},
						Required: []string{"from", "to"},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "list_tree",
					Description: "Show the project structure recursively in one call. Use this first to orient yourself. Generated directories such as node_modules, dist and .git are skipped.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"path":      {Type: "string", Description: "Directory to start from (default: '.')."},
							"max_depth": {Type: "integer", Description: "How many levels deep to go (default 3, max 8)."},
						},
					},
				},
			},
			{
				Type:     "function",
				Category: "developer",
				Function: FunctionDefinition{
					Name:        "search_files",
					Description: "Find a literal string across the project and return file:line matches. Use this to locate a function or symbol before reading whole files.",
					Parameters: ToolParametersSchema{
						Type: "object",
						Properties: map[string]ToolParameterProperty{
							"query":       {Type: "string", Description: "Literal text to find."},
							"path_filter": {Type: "string", Description: "Only search paths containing this substring (e.g. 'src/' or '.go')."},
						},
						Required: []string{"query"},
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
	"list_tree":           true,
	"search_files":        true,
	"analyze_readability": true,
	"fetch_url":           true,
	// execute_command is read-only only while project execution is off; the
	// server re-checks that at approval time rather than trusting this map.
	"execute_command": true,
	// edit_file, write_file, delete_file and move_file all change the
	// workspace and are deliberately absent.
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

	case "edit_file":
		path := getStringArg("path")
		oldString := getStringArg("old_string")
		newString := getStringArg("new_string")
		if path == "" {
			return "", fmt.Errorf("missing 'path' argument")
		}
		replaceAll := false
		if val, ok := args["replace_all"]; ok {
			if b, ok := val.(bool); ok {
				replaceAll = b
			}
		}
		return EditFile(path, oldString, newString, replaceAll)

	case "delete_file":
		path := getStringArg("path")
		if path == "" {
			return "", fmt.Errorf("missing 'path' argument")
		}
		return DeleteFile(path)

	case "move_file":
		from := getStringArg("from")
		to := getStringArg("to")
		if from == "" || to == "" {
			return "", fmt.Errorf("both 'from' and 'to' are required")
		}
		return MoveFile(from, to)

	case "list_tree":
		path := getStringArg("path")
		depth := 0
		if val, ok := args["max_depth"]; ok {
			if f, ok := val.(float64); ok {
				depth = int(f)
			}
		}
		return ListTree(path, depth)

	case "search_files":
		query := getStringArg("query")
		if query == "" {
			return "", fmt.Errorf("missing 'query' argument")
		}
		return SearchFiles(query, getStringArg("path_filter"))

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
