package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"agentui-daemon/tools"
)

func TestWorkspace_GetReportsRootAndContents(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.Mkdir(filepath.Join(dir, "pkg"), 0o755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	original := tools.Workspace()
	if _, err := tools.SetWorkspace(dir); err != nil {
		t.Fatalf("failed to set workspace: %v", err)
	}
	t.Cleanup(func() { _, _ = tools.SetWorkspace(original) })

	server := NewServer(nil, nil)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/workspace", nil))

	var resp WorkspaceResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad payload: %v", err)
	}

	// The client puts this in the system prompt, so the model can stop guessing.
	if resp.Path == "" {
		t.Fatal("expected the workspace path to be reported")
	}
	joined := fmt.Sprint(resp.Entries)
	if !bytes.Contains([]byte(joined), []byte("main.go")) || !bytes.Contains([]byte(joined), []byte("pkg/")) {
		t.Fatalf("expected a listing including main.go and pkg/, got %v", resp.Entries)
	}
}

func TestWorkspace_ChangeRepointsFileTools(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	if err := os.WriteFile(filepath.Join(second, "notes.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	original := tools.Workspace()
	if _, err := tools.SetWorkspace(first); err != nil {
		t.Fatalf("failed to set workspace: %v", err)
	}
	t.Cleanup(func() { _, _ = tools.SetWorkspace(original) })

	server := NewServer(nil, nil)
	handler := server.Handler()

	// The file lives in the second directory, so it is unreachable to begin with.
	if _, err := tools.ExecuteTool("read_file", `{"path":"notes.txt"}`); err == nil {
		t.Fatal("expected the read to fail before the workspace moves")
	}

	body := fmt.Sprintf(`{"path":%q}`, second)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/workspace", bytes.NewBufferString(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 changing the workspace, got %d: %s", w.Code, w.Body.String())
	}

	out, err := tools.ExecuteTool("read_file", `{"path":"notes.txt"}`)
	if err != nil {
		t.Fatalf("expected the read to succeed after the workspace moves: %v", err)
	}
	if out != "hello" {
		t.Fatalf("unexpected content: %q", out)
	}
}

func TestWorkspace_RejectsInvalidTargets(t *testing.T) {
	original := tools.Workspace()
	t.Cleanup(func() { _, _ = tools.SetWorkspace(original) })

	server := NewServer(nil, nil)
	handler := server.Handler()

	file := filepath.Join(t.TempDir(), "a-file.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	for _, target := range []string{"", "/definitely/not/here", file} {
		body := fmt.Sprintf(`{"path":%q}`, target)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/workspace", bytes.NewBufferString(body)))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %q, got %d", target, w.Code)
		}
	}

	// A rejected change must not have moved the sandbox.
	if tools.Workspace() != original {
		t.Fatalf("workspace moved despite a rejected request: %q", tools.Workspace())
	}
}

func TestWorkspace_IsNotExposedAsATool(t *testing.T) {
	// Changing the sandbox root is a user action. If it were a tool, a model —
	// or a prompt injected into a page it fetched — could widen its own reach.
	for _, def := range tools.AllTools() {
		if def.Function.Name == "set_workspace" || def.Function.Name == "change_workspace" {
			t.Fatalf("workspace changing must not be a callable tool")
		}
	}
}

func TestWorkspace_FlagsTheHomeDirectory(t *testing.T) {
	original := tools.Workspace()
	t.Cleanup(func() { _, _ = tools.SetWorkspace(original) })

	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory on this platform")
	}

	server := NewServer(nil, nil)
	handler := server.Handler()

	read := func() WorkspaceResponse {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/workspace", nil))
		var resp WorkspaceResponse
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("bad payload: %v", err)
		}
		return resp
	}

	// The home directory is the desktop default and almost never what the user
	// means, so the UI needs to know in order to prompt them.
	if _, err := tools.SetWorkspace(home); err != nil {
		t.Fatalf("failed to set workspace: %v", err)
	}
	if !read().IsHomeDir {
		t.Fatal("expected the home directory to be flagged")
	}

	if _, err := tools.SetWorkspace(t.TempDir()); err != nil {
		t.Fatalf("failed to set workspace: %v", err)
	}
	if read().IsHomeDir {
		t.Fatal("a project directory must not be flagged as home")
	}
}
