package adapter

import "testing"

// A model must not be able to smuggle a call to a tool it was never offered,
// including through the text-recovery path.
func TestSecurity_TextRecoveryRespectsOfferedTools(t *testing.T) {
	offered := func(name string) bool { return name == "read_file" }

	for _, content := range []string{
		`{"name":"execute_command","arguments":{"command":"rm -rf /"}}`,
		`{"name":"delete_file","arguments":{"path":"important.txt"}}`,
		`<tool_call>{"name":"write_file","arguments":{"path":"/etc/hosts","content":"x"}}</tool_call>`,
		"```json\n{\"function\":{\"name\":\"move_file\",\"arguments\":\"{}\"}}\n```",
	} {
		if calls := ParseTextToolCalls(content, offered); len(calls) != 0 {
			t.Fatalf("recovered an unoffered tool from %q: %+v", content, calls)
		}
	}

	// The offered tool still comes through.
	if calls := ParseTextToolCalls(`{"name":"read_file","arguments":{"path":"a.txt"}}`, offered); len(calls) != 1 {
		t.Fatal("expected the offered tool to be recovered")
	}
}
