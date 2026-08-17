package adapter

import (
	"encoding/json"
	"fmt"
	"strings"
)

// looseToolCall matches the shapes models emit when they write a tool call as
// prose instead of using the native field.
type looseToolCall struct {
	Name string `json:"name"`
	// Different templates use different key names for the same thing.
	Arguments  json.RawMessage `json:"arguments"`
	Parameters json.RawMessage `json:"parameters"`
	Args       json.RawMessage `json:"args"`
	Input      json.RawMessage `json:"input"`
	// Some emit the OpenAI nesting instead.
	Function *struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

func (l looseToolCall) resolve() (string, json.RawMessage) {
	name := l.Name
	args := l.Arguments

	if l.Function != nil {
		if l.Function.Name != "" {
			name = l.Function.Name
		}
		if len(l.Function.Arguments) > 0 {
			args = l.Function.Arguments
		}
	}
	for _, candidate := range []json.RawMessage{args, l.Parameters, l.Args, l.Input} {
		if len(candidate) > 0 {
			return name, candidate
		}
	}
	return name, nil
}

// jsonCandidates pulls out every plausible JSON object or array in the text.
//
// Models wrap these in ```json fences, <tool_call> tags, or nothing at all, so
// rather than matching each convention the scanner just finds balanced braces
// while respecting string literals.
func jsonCandidates(content string) []string {
	var out []string
	runes := []rune(content)

	for i := 0; i < len(runes); i++ {
		if runes[i] != '{' && runes[i] != '[' {
			continue
		}

		open := runes[i]
		close := '}'
		if open == '[' {
			close = ']'
		}

		depth := 0
		inString := false
		escaped := false

		for j := i; j < len(runes); j++ {
			c := runes[j]

			if inString {
				switch {
				case escaped:
					escaped = false
				case c == '\\':
					escaped = true
				case c == '"':
					inString = false
				}
				continue
			}

			switch c {
			case '"':
				inString = true
			case open:
				depth++
			case close:
				depth--
				if depth == 0 {
					out = append(out, string(runes[i:j+1]))
					i = j
				}
			}
			if depth == 0 && j > i {
				break
			}
		}
	}
	return out
}

// ParseTextToolCalls recovers tool calls that a model wrote into its message
// text rather than emitting through the native tool-calling channel.
//
// Small local models do this routinely — the intent is unambiguous and the JSON
// is usually well formed, so refusing to act on it just makes the agent look
// broken. isKnown gates the result: only tools that were actually offered are
// accepted, so a model cannot conjure a call to something it was never given.
func ParseTextToolCalls(content string, isKnown func(string) bool) []ToolCall {
	if strings.TrimSpace(content) == "" || isKnown == nil {
		return nil
	}

	var calls []ToolCall
	seen := make(map[string]bool)

	add := func(raw json.RawMessage) {
		var loose looseToolCall
		if err := json.Unmarshal(raw, &loose); err != nil {
			return
		}
		name, args := loose.resolve()
		name = strings.TrimSpace(name)
		if name == "" || !isKnown(name) {
			return
		}

		// Arguments may be an object or, less often, an already-encoded string.
		arguments := "{}"
		if len(args) > 0 {
			var asString string
			if err := json.Unmarshal(args, &asString); err == nil && json.Valid([]byte(asString)) {
				arguments = asString
			} else {
				arguments = string(args)
			}
		}

		key := name + "\x00" + arguments
		if seen[key] {
			return
		}
		seen[key] = true

		index := len(calls)
		calls = append(calls, ToolCall{
			Index:    index,
			ID:       fmt.Sprintf("call_text_%d", index),
			Type:     "function",
			Function: ToolCallFunction{Name: name, Arguments: arguments},
		})
	}

	for _, candidate := range jsonCandidates(content) {
		trimmed := strings.TrimSpace(candidate)

		if strings.HasPrefix(trimmed, "[") {
			var list []json.RawMessage
			if err := json.Unmarshal([]byte(trimmed), &list); err == nil {
				for _, item := range list {
					add(item)
				}
			}
			continue
		}
		add(json.RawMessage(trimmed))
	}

	return calls
}

// StripToolCallText removes recovered tool-call JSON from the prose, so the
// transcript shows the model's actual words rather than its plumbing.
func StripToolCallText(content string, isKnown func(string) bool) string {
	if isKnown == nil {
		return content
	}

	cleaned := content
	for _, candidate := range jsonCandidates(content) {
		if len(ParseTextToolCalls(candidate, isKnown)) == 0 {
			continue
		}
		cleaned = strings.Replace(cleaned, candidate, "", 1)
	}

	// Tidy up the wrappers the JSON was sitting inside.
	for _, wrapper := range []string{"<tool_call>", "</tool_call>", "```json", "```tool_code", "```"} {
		cleaned = strings.ReplaceAll(cleaned, wrapper, "")
	}

	lines := strings.Split(cleaned, "\n")
	var kept []string
	for _, line := range lines {
		if strings.TrimSpace(line) == "" && (len(kept) == 0 || strings.TrimSpace(kept[len(kept)-1]) == "") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

// toolsUnsupportedMarkers are the phrases engines use when a model has no
// tool-calling template. Matching on text is unpleasant but there is no status
// code or error type that distinguishes this from any other bad request.
var toolsUnsupportedMarkers = []string{
	"does not support tools",
	"does not support function",
	"tools are not supported",
	"tool calling is not supported",
	"no tool support",
}

// IsToolsUnsupported reports whether an engine error means the model cannot do
// tool calling, as opposed to the request being wrong in some other way.
func IsToolsUnsupported(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, marker := range toolsUnsupportedMarkers {
		if strings.Contains(msg, marker) {
			return true
		}
	}
	return false
}

// LooksLikeAttemptedToolCall reports whether the text appears to be a tool call
// the model failed to encode correctly.
//
// Small models routinely emit invalid JSON — most often an unescaped quote
// inside HTML they are writing to a file. Nothing can be recovered from that,
// but staying silent is the worst outcome: the tool never runs, the model gets
// no error, and it goes on to tell the user the work is done.
func LooksLikeAttemptedToolCall(content string, isKnown func(string) bool) bool {
	if isKnown == nil || strings.TrimSpace(content) == "" {
		return false
	}
	// Something already parsed cleanly is not a failed attempt.
	if len(ParseTextToolCalls(content, isKnown)) > 0 {
		return false
	}

	lower := strings.ToLower(content)
	// The shape of a call: a name field, an arguments field, and a tool we offered.
	hasNameField := strings.Contains(lower, `"name"`) || strings.Contains(lower, "'name'")
	hasArgsField := strings.Contains(lower, `"arguments"`) ||
		strings.Contains(lower, `"parameters"`) ||
		strings.Contains(lower, "<tool_call>")
	if !hasNameField && !hasArgsField {
		return false
	}

	for _, candidate := range jsonCandidates(content) {
		var probe struct {
			Name string `json:"name"`
		}
		// Even unparseable blobs usually have a readable name near the start.
		if err := json.Unmarshal([]byte(candidate), &probe); err == nil && isKnown(probe.Name) {
			return true
		}
	}

	// Fall back to looking for a known tool name quoted as a value.
	for _, marker := range []string{`"name": "`, `"name":"`} {
		idx := strings.Index(content, marker)
		for idx >= 0 {
			rest := content[idx+len(marker):]
			if end := strings.IndexByte(rest, '"'); end > 0 && isKnown(rest[:end]) {
				return true
			}
			next := strings.Index(rest, marker)
			if next < 0 {
				break
			}
			idx = idx + len(marker) + next
		}
	}
	return false
}
