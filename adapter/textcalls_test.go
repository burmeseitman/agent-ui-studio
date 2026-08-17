package adapter

import (
	"encoding/json"
	"strings"
	"testing"
)

func known(names ...string) func(string) bool {
	set := make(map[string]bool, len(names))
	for _, n := range names {
		set[n] = true
	}
	return func(name string) bool { return set[name] }
}

// The exact output qwen2.5-coder:7b produced instead of a native tool call.
const qwenCoderOutput = `{"name": "write_file", "arguments": {"path": "site/index.html", "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <title>My Site</title>\n</head>\n<body>\n    <p>Welcome</p>\n</body>\n</html>"}}`

func TestParseTextToolCalls_RecoversBareJSON(t *testing.T) {
	calls := ParseTextToolCalls(qwenCoderOutput, known("write_file"))
	if len(calls) != 1 {
		t.Fatalf("expected 1 recovered call, got %d", len(calls))
	}
	if calls[0].Function.Name != "write_file" {
		t.Fatalf("unexpected name: %s", calls[0].Function.Name)
	}

	// Arguments must survive as valid JSON, escapes and all.
	var args struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(calls[0].Function.Arguments), &args); err != nil {
		t.Fatalf("arguments are not valid JSON: %v", err)
	}
	if args.Path != "site/index.html" {
		t.Fatalf("unexpected path: %s", args.Path)
	}
	if !strings.Contains(args.Content, "<title>My Site</title>") {
		t.Fatalf("content was mangled: %q", args.Content)
	}
}

func TestParseTextToolCalls_HandlesCommonWrappers(t *testing.T) {
	cases := map[string]string{
		"fenced":     "Here you go:\n```json\n{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}\n```",
		"tool_call":  "<tool_call>\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"a.txt\"}}\n</tool_call>",
		"parameters": `{"name":"read_file","parameters":{"path":"a.txt"}}`,
		"openai":     `{"function":{"name":"read_file","arguments":"{\"path\":\"a.txt\"}"}}`,
		"prose":      "I will read it.\n{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}\nThen continue.",
	}

	for label, content := range cases {
		t.Run(label, func(t *testing.T) {
			calls := ParseTextToolCalls(content, known("read_file"))
			if len(calls) != 1 {
				t.Fatalf("expected 1 call, got %d", len(calls))
			}
			if calls[0].Function.Name != "read_file" {
				t.Fatalf("unexpected name: %s", calls[0].Function.Name)
			}
			if !strings.Contains(calls[0].Function.Arguments, "a.txt") {
				t.Fatalf("arguments lost: %s", calls[0].Function.Arguments)
			}
		})
	}
}

func TestParseTextToolCalls_HandlesMultipleCalls(t *testing.T) {
	content := `[{"name":"read_file","arguments":{"path":"a.txt"}},{"name":"read_file","arguments":{"path":"b.txt"}}]`
	calls := ParseTextToolCalls(content, known("read_file"))
	if len(calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(calls))
	}
	if calls[0].Index == calls[1].Index {
		t.Fatal("recovered calls must have distinct indices")
	}
}

func TestParseTextToolCalls_RefusesUnofferedTools(t *testing.T) {
	// A model must not be able to invent a call to something it was never given.
	content := `{"name":"delete_file","arguments":{"path":"important.txt"}}`
	if calls := ParseTextToolCalls(content, known("read_file")); len(calls) != 0 {
		t.Fatalf("expected an unoffered tool to be ignored, got %d calls", len(calls))
	}
}

func TestParseTextToolCalls_IgnoresOrdinaryProse(t *testing.T) {
	for _, content := range []string{
		"Here is a JSON example: {\"path\": \"a.txt\"}",
		"The config is {\"name\": \"my-app\", \"version\": \"1.0.0\"}",
		"No JSON here at all.",
		"",
	} {
		if calls := ParseTextToolCalls(content, known("read_file", "write_file")); len(calls) != 0 {
			t.Fatalf("expected no calls from %q, got %d", content, len(calls))
		}
	}
}

func TestStripToolCallText_LeavesOnlyProse(t *testing.T) {
	content := "I'll create that file for you.\n```json\n" + qwenCoderOutput + "\n```\nLet me know if you want changes."
	cleaned := StripToolCallText(content, known("write_file"))

	if strings.Contains(cleaned, "write_file") || strings.Contains(cleaned, "DOCTYPE") {
		t.Fatalf("tool call JSON survived stripping:\n%s", cleaned)
	}
	if !strings.Contains(cleaned, "I'll create that file") {
		t.Fatalf("prose was lost:\n%s", cleaned)
	}
	if !strings.Contains(cleaned, "Let me know") {
		t.Fatalf("trailing prose was lost:\n%s", cleaned)
	}
}
