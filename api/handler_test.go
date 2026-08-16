package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"agentui-daemon/adapter"
	"agentui-daemon/engine"
	"agentui-daemon/tools"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestHandleGetEngines(t *testing.T) {
	mockClient := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.Host == "mock-ollama:11434" && req.URL.Path == "/api/tags" {
				body := `{"models": [{"name": "llama3:8b"}, {"name": "qwen2.5-coder:7b"}]}`
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(bytes.NewBufferString(body)),
					Header:     make(http.Header),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusNotFound,
				Body:       io.NopCloser(bytes.NewBufferString("not found")),
				Header:     make(http.Header),
			}, nil
		}),
	}

	targets := []engine.Target{
		{
			Name:      "ollama",
			URL:       "http://mock-ollama:11434",
			ProbeFunc: engine.ProbeOllama,
		},
		{
			Name:      "lmstudio",
			URL:       "http://mock-lmstudio:1234",
			ProbeFunc: engine.ProbeOpenAICompat,
		},
	}

	scanner := engine.NewScannerWithClient(mockClient, 0, targets...)
	server := NewServer(scanner, nil)
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/engines", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", contentType)
	}

	var resp engine.EnginesResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Engines) != 2 {
		t.Fatalf("expected 2 engines, got %d", len(resp.Engines))
	}

	ollamaEngine := resp.Engines[0]
	if ollamaEngine.Name != "ollama" || !ollamaEngine.Active {
		t.Errorf("unexpected ollama status: %+v", ollamaEngine)
	}
	expectedModels := []string{"llama3:8b", "qwen2.5-coder:7b"}
	if !reflect.DeepEqual(ollamaEngine.Models, expectedModels) {
		t.Errorf("expected models %v, got %v", expectedModels, ollamaEngine.Models)
	}

	lmstudioEngine := resp.Engines[1]
	if lmstudioEngine.Name != "lmstudio" || lmstudioEngine.Active || len(lmstudioEngine.Models) != 0 {
		t.Errorf("unexpected lmstudio status: %+v", lmstudioEngine)
	}
}

func TestHandleChatCompletions_StreamSuccess(t *testing.T) {
	mockClient := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.Host == "mock-ollama:11434" && req.URL.Path == "/api/chat" {
				ndjson := `{"model":"llama3:8b","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama3:8b","message":{"role":"assistant","content":" world!"},"done":true}
`
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(bytes.NewBufferString(ndjson)),
					Header:     make(http.Header),
				}, nil
			}
			return &http.Response{StatusCode: http.StatusNotFound}, nil
		}),
	}

	router := adapter.NewRouter(mockClient, "http://mock-ollama:11434", "http://mock-lmstudio:1234")
	server := NewServer(nil, router)
	handler := server.Handler()

	requestBody := `{
		"engine": "ollama",
		"model": "llama3:8b",
		"messages": [{"role": "user", "content": "hi"}]
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(requestBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}

	contentType := w.Header().Get("Content-Type")
	if !strings.HasPrefix(contentType, "text/event-stream") {
		t.Errorf("expected Content-Type text/event-stream, got %s", contentType)
	}

	responseString := w.Body.String()
	if !strings.Contains(responseString, "data: [DONE]") {
		t.Errorf("expected stream to end with [DONE], got:\n%s", responseString)
	}
	if !strings.Contains(responseString, "Hello") || !strings.Contains(responseString, "world!") {
		t.Errorf("expected stream to contain tokens, got:\n%s", responseString)
	}
}

func TestHandleGetTools(t *testing.T) {
	server := NewServer(nil, nil)
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tools?profession=developer", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for GET /api/v1/tools, got %d", w.Code)
	}

	var resp ToolsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode tools response: %v", err)
	}

	if len(resp.Tools) == 0 {
		t.Fatal("expected tools in response, got 0")
	}
	if len(resp.AllowedCommands) == 0 {
		t.Fatal("expected the command allowlist to be advertised")
	}
}

func TestHandleExecuteTool(t *testing.T) {
	server := NewServer(nil, nil)
	handler := server.Handler()

	reqBody := `{"name":"analyze_readability","arguments":"{\"text\":\"This is a clean and simple test sentence.\"}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tools/execute", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for execute tool, got %d", w.Code)
	}

	var result tools.ToolResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode tool result: %v", err)
	}

	if result.Error != "" {
		t.Fatalf("tool execution error: %s", result.Error)
	}
	if !strings.Contains(result.Output, "Word Count") {
		t.Fatalf("unexpected tool output: %s", result.Output)
	}
}

func TestHandleChatCompletions_ValidationErrors(t *testing.T) {
	server := NewServer(nil, nil)
	handler := server.Handler()

	// Invalid JSON
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString("bad json"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", w.Code)
	}

	// Missing model
	req = httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(`{"messages":[{"role":"user","content":"hi"}]}`))
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing model, got %d", w.Code)
	}

	// Empty messages
	req = httptest.NewRequest(http.MethodPost, "/api/v1/chat/completions", bytes.NewBufferString(`{"model":"llama3:8b","messages":[]}`))
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty messages, got %d", w.Code)
	}
}

func TestHandleHealth(t *testing.T) {
	server := NewServer(nil, nil)
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var body HealthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse health JSON: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("expected status ok, got %s", body.Status)
	}
}

func TestSecurity_CORSPolicies(t *testing.T) {
	server := NewServer(nil, nil)
	handler := server.Handler()

	// 1. Legitimate local origin (localhost:5173) -> Allowed
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/engines", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for localhost preflight OPTIONS, got %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Errorf("expected allowed origin header to reflect trusted origin")
	}

	// 2. Untrusted malicious external website -> Rejected with 403 Forbidden
	maliciousReq := httptest.NewRequest(http.MethodPost, "/api/v1/tools/execute", bytes.NewBufferString(`{"name":"execute_command"}`))
	maliciousReq.Header.Set("Origin", "https://evil-attacker-website.com")
	maliciousRecorder := httptest.NewRecorder()
	handler.ServeHTTP(maliciousRecorder, maliciousReq)

	if maliciousRecorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for untrusted external web origin, got %d", maliciousRecorder.Code)
	}
}
