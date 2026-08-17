package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Trusting every localhost port let any dev server the user happened to run —
// including one serving a freshly cloned project — reconfigure the workspace,
// enable command execution, and run code.
func TestSecurity_OnlyTheAppsOwnOriginsAreTrusted(t *testing.T) {
	server := NewServer(nil, nil)
	server.SetAllowedOrigins(8080, nil)
	handler := server.Handler()

	trusted := []string{
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"http://localhost:5173",
		"tauri://localhost",
		"http://tauri.localhost",
	}
	rejected := []string{
		"http://localhost:3000",
		"http://127.0.0.1:9999",
		"http://localhost:1337",
		"https://evil.example",
		"http://evil.example:5173",
	}

	probe := func(origin string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tools/execute",
			bytes.NewBufferString(`{"name":"list_dir","arguments":"{\"path\":\".\"}"}`))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w.Code
	}

	for _, origin := range trusted {
		if code := probe(origin); code == http.StatusForbidden {
			t.Fatalf("expected %s to be trusted, got 403", origin)
		}
	}
	for _, origin := range rejected {
		if code := probe(origin); code != http.StatusForbidden {
			t.Fatalf("expected %s to be rejected, got %d", origin, code)
		}
	}
}

func TestSecurity_ExtraOriginsCanBeOptedIn(t *testing.T) {
	server := NewServer(nil, nil)
	server.SetAllowedOrigins(8080, []string{"http://localhost:3000"})
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tools", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code == http.StatusForbidden {
		t.Fatal("an explicitly allowed origin must be accepted")
	}
}

func TestSecurity_NonBrowserClientsStillWork(t *testing.T) {
	server := NewServer(nil, nil)
	server.SetAllowedOrigins(8080, nil)

	// curl and the CLI send no Origin; they are constrained by the loopback
	// binding and, when configured, the API token.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tools", nil)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected an origin-less request to succeed, got %d", w.Code)
	}
}

// Changing the sandbox root and enabling code execution are user actions. If a
// model could reach them it could widen its own reach; the CSRF chain that made
// this dangerous was: set workspace to /, enable execution, write a script, run it.
func TestSecurity_PrivilegedEndpointsAreNotTools(t *testing.T) {
	server := NewServer(nil, nil)
	server.SetAllowedOrigins(8080, nil)
	handler := server.Handler()

	// A hostile page on an untrusted origin cannot reach either endpoint.
	for _, path := range []string{"/api/v1/workspace", "/api/v1/settings"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"path":"/","project_execution":true}`))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected %s to reject an untrusted origin, got %d", path, w.Code)
		}
	}
}
