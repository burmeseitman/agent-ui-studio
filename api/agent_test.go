package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"agentui-daemon/adapter"
)

// newToolCallingOllama returns a client that answers the first /api/chat call
// with a tool call and every subsequent call with plain text, so the agent loop
// terminates. It records the request bodies for assertions.
func newToolCallingOllama(t *testing.T, toolName, argsJSON string) (*http.Client, func() []map[string]any) {
	t.Helper()

	var (
		mu       sync.Mutex
		bodies   []map[string]any
		callSeen int
	)

	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(req.Body)
			var parsed map[string]any
			_ = json.Unmarshal(raw, &parsed)

			mu.Lock()
			bodies = append(bodies, parsed)
			callSeen++
			first := callSeen == 1
			mu.Unlock()

			var ndjson string
			if first {
				ndjson = `{"model":"llama3","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"` +
					toolName + `","arguments":` + argsJSON + `}}]},"done":false}` + "\n" +
					`{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":11,"eval_count":7,"eval_duration":2000000}` + "\n"
			} else {
				ndjson = `{"model":"llama3","message":{"role":"assistant","content":"All done."},"done":false}` + "\n" +
					`{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":20,"eval_count":4,"eval_duration":1000000}` + "\n"
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(ndjson)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	return client, func() []map[string]any {
		mu.Lock()
		defer mu.Unlock()
		return bodies
	}
}

func TestChatCompletions_ToolSchemasAreSentToEngine(t *testing.T) {
	client, bodies := newToolCallingOllama(t, "analyze_readability", `{"text":"A short sentence."}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","enabled_tools":["analyze_readability","read_file"],` +
		`"messages":[{"role":"user","content":"analyze this"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	sent := bodies()
	if len(sent) == 0 {
		t.Fatal("engine was never called")
	}

	tools, ok := sent[0]["tools"].([]any)
	if !ok || len(tools) != 2 {
		t.Fatalf("expected 2 tool schemas forwarded to the engine, got %#v", sent[0]["tools"])
	}
}

func TestChatCompletions_UnknownToolNamesAreIgnored(t *testing.T) {
	client, bodies := newToolCallingOllama(t, "analyze_readability", `{"text":"hi"}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","enabled_tools":["not_a_real_tool"],` +
		`"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if tools, present := bodies()[0]["tools"]; present {
		t.Fatalf("unknown tool names must not reach the engine, got %#v", tools)
	}
}

func TestChatCompletions_ManualModeStopsAtToolCall(t *testing.T) {
	client, bodies := newToolCallingOllama(t, "analyze_readability", `{"text":"A short sentence."}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","enabled_tools":["analyze_readability"],` +
		`"messages":[{"role":"user","content":"analyze this"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if got := len(bodies()); got != 1 {
		t.Fatalf("manual mode must not re-prompt the engine, saw %d calls", got)
	}

	out := w.Body.String()
	if !strings.Contains(out, `"tool_calls"`) {
		t.Fatalf("expected tool calls to be streamed to the client:\n%s", out)
	}
	if strings.Contains(out, objectToolResult) {
		t.Fatalf("manual mode must not execute tools server-side:\n%s", out)
	}
}

func TestChatCompletions_AutoModeExecutesAndContinues(t *testing.T) {
	client, bodies := newToolCallingOllama(t, "analyze_readability", `{"text":"A short and simple sentence."}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","tool_mode":"auto","enabled_tools":["analyze_readability"],` +
		`"messages":[{"role":"user","content":"analyze this"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	sent := bodies()
	if len(sent) != 2 {
		t.Fatalf("expected the loop to re-prompt the engine once, saw %d calls", len(sent))
	}

	// The follow-up request must carry the tool result back to the model.
	messages, _ := sent[1]["messages"].([]any)
	var sawToolRole bool
	for _, m := range messages {
		msg, _ := m.(map[string]any)
		if msg["role"] == "tool" && strings.Contains(msg["content"].(string), "Word Count") {
			sawToolRole = true
		}
	}
	if !sawToolRole {
		t.Fatalf("expected a tool result message in the follow-up request, got %#v", messages)
	}

	out := w.Body.String()
	if !strings.Contains(out, objectToolResult) {
		t.Fatalf("expected a tool_result event in the stream:\n%s", out)
	}
	if !strings.Contains(out, "All done.") {
		t.Fatalf("expected the final answer in the stream:\n%s", out)
	}
}

func TestChatCompletions_UsageIsForwarded(t *testing.T) {
	client, _ := newToolCallingOllama(t, "analyze_readability", `{"text":"hi"}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	out := w.Body.String()
	if !strings.Contains(out, `"completion_tokens":7`) {
		t.Fatalf("expected engine-reported usage in the stream:\n%s", out)
	}
}

func TestChatCompletions_RejectsUnknownToolMode(t *testing.T) {
	server := NewServer(nil, nil)
	body := `{"model":"llama3","tool_mode":"yolo","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an unknown tool mode, got %d", w.Code)
	}
}

func TestExecuteTool_RejectsUnknownTool(t *testing.T) {
	server := NewServer(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tools/execute",
		bytes.NewBufferString(`{"name":"rm_rf","arguments":"{}"}`))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an unknown tool, got %d", w.Code)
	}
}

func TestSecurity_AuthRequiredOnReadEndpoints(t *testing.T) {
	original := APIToken
	APIToken = "s3cret"
	t.Cleanup(func() { APIToken = original })

	server := NewServer(nil, nil)
	handler := server.Handler()

	// GET endpoints disclose the local model and tool inventory: they must not
	// be exempt from auth just because they are reads.
	for _, path := range []string{"/api/v1/engines", "/api/v1/tools"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for unauthenticated GET %s, got %d", path, w.Code)
		}

		w = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer s3cret")
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 for authenticated GET %s, got %d", path, w.Code)
		}
	}

	// /health stays open so orchestrators can probe the daemon.
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected /health to remain public, got %d", w.Code)
	}
}

func TestChatCompletions_AutoApproveListGatesExecution(t *testing.T) {
	// analyze_readability is not in auto_approve_tools, so the batch must be
	// handed to the user instead of executed.
	client, bodies := newToolCallingOllama(t, "analyze_readability", `{"text":"hi"}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","tool_mode":"auto",` +
		`"enabled_tools":["analyze_readability","list_dir"],"auto_approve_tools":["list_dir"],` +
		`"messages":[{"role":"user","content":"analyze this"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if got := len(bodies()); got != 1 {
		t.Fatalf("a non-approved tool must not be executed or looped on, saw %d engine calls", got)
	}
	out := w.Body.String()
	if strings.Contains(out, objectToolResult) {
		t.Fatalf("non-approved tool was executed server-side:\n%s", out)
	}
	if !strings.Contains(out, `"tool_calls"`) {
		t.Fatalf("expected the call to be streamed for approval:\n%s", out)
	}
}

func TestChatCompletions_AutoApproveListAllowsListedTool(t *testing.T) {
	client, bodies := newToolCallingOllama(t, "analyze_readability", `{"text":"A short sentence."}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","tool_mode":"auto",` +
		`"enabled_tools":["analyze_readability"],"auto_approve_tools":["analyze_readability"],` +
		`"messages":[{"role":"user","content":"analyze this"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if got := len(bodies()); got != 2 {
		t.Fatalf("an approved tool should run and continue the loop, saw %d engine calls", got)
	}
	if !strings.Contains(w.Body.String(), objectToolResult) {
		t.Fatal("expected the approved tool to be executed server-side")
	}
}

func TestChatCompletions_ToolNeverOfferedIsNotExecuted(t *testing.T) {
	// A rogue or confused engine returns a call for a tool the daemon never
	// advertised; it must not run just because auto mode is on.
	client, bodies := newToolCallingOllama(t, "write_file", `{"path":"x.txt","content":"pwned"}`)
	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))

	body := `{"model":"llama3","engine":"ollama","tool_mode":"auto","enabled_tools":["list_dir"],` +
		`"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if got := len(bodies()); got != 1 {
		t.Fatalf("an unoffered tool must not be executed, saw %d engine calls", got)
	}
	if strings.Contains(w.Body.String(), objectToolResult) {
		t.Fatal("an unoffered tool was executed server-side")
	}
}

func TestHealth_ReportsWhetherAuthIsRequired(t *testing.T) {
	server := NewServer(nil, nil)

	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	var open HealthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &open); err != nil {
		t.Fatalf("bad health payload: %v", err)
	}
	if open.AuthRequired {
		t.Fatal("expected auth_required=false with no token configured")
	}

	original := APIToken
	APIToken = "s3cret"
	t.Cleanup(func() { APIToken = original })

	w = httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	var locked HealthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &locked); err != nil {
		t.Fatalf("bad health payload: %v", err)
	}
	if !locked.AuthRequired {
		t.Fatal("expected auth_required=true when a token is configured")
	}
	if locked.Status != "ok" {
		t.Fatal("health must stay reachable without a token")
	}
}

func TestChatCompletions_RecoversToolCallsWrittenAsText(t *testing.T) {
	// qwen2.5-coder:7b emits exactly this instead of a native tool call.
	textCall := `{\"name\": \"analyze_readability\", \"arguments\": {\"text\": \"A short sentence.\"}}`

	var calls int
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			_, _ = io.ReadAll(req.Body)
			calls++

			var ndjson string
			if calls == 1 {
				ndjson = `{"model":"c","message":{"role":"assistant","content":"` + textCall + `"},"done":false}` + "\n" +
					`{"model":"c","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}` + "\n"
			} else {
				ndjson = `{"model":"c","message":{"role":"assistant","content":"Done."},"done":false}` + "\n" +
					`{"model":"c","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}` + "\n"
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(ndjson)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))
	body := `{"model":"c","engine":"ollama","tool_mode":"auto","enabled_tools":["analyze_readability"],` +
		`"auto_approve_tools":["analyze_readability"],"messages":[{"role":"user","content":"analyze"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	out := w.Body.String()
	if !strings.Contains(out, objectTextCalls) {
		t.Fatalf("expected a text-tool-call recovery event:\n%s", out)
	}
	if !strings.Contains(out, objectToolResult) {
		t.Fatalf("expected the recovered call to be executed:\n%s", out)
	}
	if calls != 2 {
		t.Fatalf("expected the loop to continue after the recovered call, saw %d engine calls", calls)
	}
}

func TestChatCompletions_DegradesWhenModelLacksToolSupport(t *testing.T) {
	var sawTools []bool
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(req.Body)
			sawTools = append(sawTools, strings.Contains(string(raw), `"tools"`))

			if strings.Contains(string(raw), `"tools"`) {
				return &http.Response{
					StatusCode: http.StatusBadRequest,
					Body:       io.NopCloser(strings.NewReader(`{"error":"registry.ollama.ai/library/starcoder2:3b does not support tools"}`)),
					Header:     make(http.Header),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body: io.NopCloser(strings.NewReader(
					`{"model":"s","message":{"role":"assistant","content":"Plain answer."},"done":true}` + "\n")),
				Header: make(http.Header),
			}, nil
		}),
	}

	server := NewServer(nil, adapter.NewRouter(client, "http://mock-ollama:11434", ""))
	body := `{"model":"starcoder2:3b","engine":"ollama","enabled_tools":["read_file"],` +
		`"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	out := w.Body.String()
	// A raw 400 is useless to the user; a plain answer plus an explanation is not.
	if strings.Contains(out, "does not support tools") && !strings.Contains(out, objectNotice) {
		t.Fatalf("expected the raw engine error to be replaced by a notice:\n%s", out)
	}
	if !strings.Contains(out, "Plain answer.") {
		t.Fatalf("expected the retry without tools to produce an answer:\n%s", out)
	}
	if !strings.Contains(out, objectNotice) {
		t.Fatalf("expected a notice explaining the model cannot use tools:\n%s", out)
	}
	if len(sawTools) != 2 || !sawTools[0] || sawTools[1] {
		t.Fatalf("expected one attempt with tools then one without, got %v", sawTools)
	}
}
