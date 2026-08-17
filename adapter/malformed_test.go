package adapter

import "testing"

// A model that emits a tool call with unescaped quotes produces invalid JSON.
// Nothing can be recovered from it — the question is whether we can at least
// tell that an attempt was made.
func TestMalformedToolCallIsNotSilent(t *testing.T) {
	known := func(n string) bool { return n == "write_file" }

	malformed := `{"name": "write_file", "arguments": {"path": "a.html", "content": "<button class="btn">x</button>"}}`

	if calls := ParseTextToolCalls(malformed, known); len(calls) != 0 {
		t.Fatalf("unexpectedly parsed invalid JSON: %+v", calls)
	}
	t.Logf("recovered nothing from malformed JSON, as expected")

	if !LooksLikeAttemptedToolCall(malformed, known) {
		t.Fatal("an obvious tool-call attempt was not detected")
	}
	if LooksLikeAttemptedToolCall("Here is some ordinary prose about a file.", known) {
		t.Fatal("ordinary prose must not be mistaken for a tool call")
	}
}
