package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"agentui-daemon/adapter"
	"agentui-daemon/engine"
	"agentui-daemon/tools"
)

// APIToken, when non-empty, is required on every endpoint except /health.
var APIToken string

type ctxKey string

const requestIDKey ctxKey = "request_id"

const engineCacheTTL = 15 * time.Second

// Server encapsulates the HTTP API router and dependencies.
type Server struct {
	scanner *engine.Scanner
	router  *adapter.Router
	mux     *http.ServeMux

	// cacheMu guards the cached scan result only; the scan itself runs without
	// the lock held so a slow probe cannot serialize every caller.
	cacheMu       sync.Mutex
	cachedEngines []engine.EngineInfo
	cacheTime     time.Time
	scanning      bool
	scanDone      chan struct{}

	toolLimiter *rateLimiter
	staticDir   string

	// originMu guards the browser origins permitted to call the API.
	originMu       sync.RWMutex
	allowedOrigins map[string]bool
}

// SetAllowedOrigins fixes which browser origins may drive the daemon.
//
// Trusting every localhost port is not safe: any dev server the user happens to
// run — including one serving a project they just cloned — could otherwise
// reconfigure the workspace, enable command execution, and run code. Only the
// app's own origins are trusted by default.
func (s *Server) SetAllowedOrigins(port int, extra []string) {
	allowed := map[string]bool{
		// The desktop shell.
		"tauri://localhost":       true,
		"http://tauri.localhost":  true,
		"https://tauri.localhost": true,
	}
	// The daemon's own origin, for the bundled frontend.
	for _, host := range []string{"localhost", "127.0.0.1"} {
		allowed[fmt.Sprintf("http://%s:%d", host, port)] = true
	}
	// The Vite dev server, which is how the app runs during development.
	for _, devPort := range []int{5173, 1420} {
		for _, host := range []string{"localhost", "127.0.0.1"} {
			allowed[fmt.Sprintf("http://%s:%d", host, devPort)] = true
		}
	}
	for _, origin := range extra {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			allowed[trimmed] = true
		}
	}

	s.originMu.Lock()
	s.allowedOrigins = allowed
	s.originMu.Unlock()
}

// isAllowedOrigin reports whether a browser origin may call the API.
func (s *Server) isAllowedOrigin(origin string) bool {
	if origin == "" {
		// Non-browser clients (curl, the CLI) send no Origin. They are already
		// constrained by the loopback binding and, when set, the API token.
		return true
	}

	s.originMu.RLock()
	allowed := s.allowedOrigins
	s.originMu.RUnlock()

	if allowed[origin] {
		return true
	}

	// Tauri serves the app from a scheme-based origin on some platforms.
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return parsed.Scheme == "tauri" || strings.EqualFold(parsed.Hostname(), "tauri.localhost")
}

// NewServer initializes a new Server with engine scanner and adapter router.
func NewServer(scanner *engine.Scanner, router *adapter.Router) *Server {
	if scanner == nil {
		scanner = engine.NewScanner(0)
	}
	if router == nil {
		router = adapter.NewRouter(nil, "", "")
	}

	s := &Server{
		scanner:     scanner,
		router:      router,
		mux:         http.NewServeMux(),
		toolLimiter: newRateLimiter(30, time.Minute),
	}

	// Establish the default origin policy up front so a Server is never
	// accidentally permissive — or accidentally unusable — before configuration.
	s.SetAllowedOrigins(8080, nil)

	s.routes()
	return s
}

// ServeStaticFrom makes the server host a built frontend from dir, with SPA
// fallback to index.html. A missing directory is ignored so the daemon still
// runs API-only.
func (s *Server) ServeStaticFrom(dir string) {
	if dir == "" {
		return
	}
	if info, err := os.Stat(filepath.Join(dir, "index.html")); err != nil || info.IsDir() {
		slog.Debug("no frontend bundle found, running API-only", "dir", dir)
		return
	}
	s.staticDir = dir
	s.mux.HandleFunc("GET /", s.handleStatic)
	slog.Info("Serving frontend bundle", "dir", dir)
}

// routes registers API handlers.
func (s *Server) routes() {
	s.mux.Handle("GET /api/v1/engines", http.TimeoutHandler(http.HandlerFunc(s.handleGetEngines), 30*time.Second, `{"error": "request timeout"}`))
	s.mux.HandleFunc("POST /api/v1/chat/completions", s.handleChatCompletions)
	s.mux.Handle("GET /api/v1/tools", http.TimeoutHandler(http.HandlerFunc(s.handleGetTools), 30*time.Second, `{"error": "request timeout"}`))
	s.mux.Handle("POST /api/v1/tools/execute", http.TimeoutHandler(http.HandlerFunc(s.handleExecuteTool), 30*time.Second, `{"error": "request timeout"}`))
	s.mux.Handle("GET /api/v1/workspace", http.TimeoutHandler(http.HandlerFunc(s.handleGetWorkspace), 10*time.Second, `{"error": "request timeout"}`))
	s.mux.Handle("POST /api/v1/workspace", http.TimeoutHandler(http.HandlerFunc(s.handleSetWorkspace), 10*time.Second, `{"error": "request timeout"}`))
	s.mux.Handle("GET /api/v1/settings", http.TimeoutHandler(http.HandlerFunc(s.handleGetSettings), 10*time.Second, `{"error": "request timeout"}`))
	s.mux.Handle("POST /api/v1/settings", http.TimeoutHandler(http.HandlerFunc(s.handleSetSettings), 10*time.Second, `{"error": "request timeout"}`))
	s.mux.Handle("GET /health", http.TimeoutHandler(http.HandlerFunc(s.handleHealth), 5*time.Second, `{"error": "request timeout"}`))
}

func (s *Server) requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 4)
		if _, err := rand.Read(b); err != nil {
			slog.Warn("failed to generate request id", "error", err)
		}
		id := hex.EncodeToString(b)
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "request_id", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Handler returns the HTTP handler with secure CORS middleware and security headers.
func (s *Server) Handler() http.Handler {
	return s.requestIDMiddleware(s.corsMiddleware(s.authMiddleware(s.mux)))
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// scanEngines returns cached discovery results, refreshing them at most once at
// a time. Callers that arrive during an in-flight scan wait for it rather than
// starting their own.
func (s *Server) scanEngines() []engine.EngineInfo {
	for {
		s.cacheMu.Lock()
		if time.Since(s.cacheTime) <= engineCacheTTL && s.cachedEngines != nil {
			cached := s.cachedEngines
			s.cacheMu.Unlock()
			return cached
		}
		if s.scanning {
			wait := s.scanDone
			s.cacheMu.Unlock()
			<-wait
			continue
		}
		s.scanning = true
		s.scanDone = make(chan struct{})
		done := s.scanDone
		s.cacheMu.Unlock()

		results := s.scanner.Scan()

		s.cacheMu.Lock()
		s.cachedEngines = results
		s.cacheTime = time.Now()
		s.scanning = false
		s.cacheMu.Unlock()
		close(done)

		return results
	}
}

func (s *Server) handleGetEngines(w http.ResponseWriter, r *http.Request) {
	resp := engine.EnginesResponse{Engines: s.scanEngines()}

	respBytes, err := json.Marshal(resp)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to encode response")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(respBytes)
}

// handleChatCompletions receives chat completion requests and streams tokens via SSE.
func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	// Limit request body to 10MB to prevent DoS memory exhaustion
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)

	var req adapter.ChatCompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}

	if req.Model == "" {
		writeJSONError(w, http.StatusBadRequest, "model is required")
		return
	}

	if len(req.Messages) == 0 {
		writeJSONError(w, http.StatusBadRequest, "messages cannot be empty")
		return
	}

	if req.ToolMode == "" {
		req.ToolMode = adapter.ToolModeManual
	}
	if req.ToolMode != adapter.ToolModeManual && req.ToolMode != adapter.ToolModeAuto {
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("tool_mode must be %q or %q", adapter.ToolModeManual, adapter.ToolModeAuto))
		return
	}

	// Tool schemas are resolved from the registry; the client only names them.
	req.Tools = resolveTools(req.EnabledTools)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "streaming unsupported by response writer")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	emit := func(v any) error {
		payload, err := json.Marshal(v)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	if err := s.runAgentLoop(r.Context(), &req, emit); err != nil {
		// The status line is already committed, so stream errors are delivered
		// as a terminal SSE event rather than an HTTP status.
		errEvent, _ := json.Marshal(map[string]string{"error": err.Error()})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", errEvent)
		flusher.Flush()
	}

	_, _ = fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()
}

// WorkspaceResponse reports the directory the file tools are confined to.
//
// The model has no other way to learn where it is: without this the client
// cannot tell it, and every relative path the model guesses fails.
type WorkspaceResponse struct {
	Path string `json:"path"`
	// Entries is a shallow listing, so the client can show the user what the
	// agent can actually see.
	Entries []string `json:"entries,omitempty"`
	// IsHomeDir marks the default that is almost never what the user wants, so
	// the UI can prompt them to pick an actual project folder.
	IsHomeDir bool `json:"is_home_dir"`
}

type setWorkspaceRequest struct {
	Path string `json:"path"`
}

func workspaceEntries(root string, limit int) []string {
	dir, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	names := make([]string, 0, limit)
	for _, entry := range dir {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if entry.IsDir() {
			name += "/"
		}
		names = append(names, name)
		if len(names) >= limit {
			break
		}
	}
	return names
}

// isHomeDir reports whether the path is the user's home directory itself.
func isHomeDir(path string) bool {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return false
	}
	resolvedHome, err := filepath.EvalSymlinks(home)
	if err != nil {
		resolvedHome = home
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		resolvedPath = path
	}
	return filepath.Clean(resolvedPath) == filepath.Clean(resolvedHome)
}

func describeWorkspace(root string) WorkspaceResponse {
	return WorkspaceResponse{
		Path:      root,
		Entries:   workspaceEntries(root, 40),
		IsHomeDir: isHomeDir(root),
	}
}

func (s *Server) handleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(describeWorkspace(tools.Workspace()))
}

// handleSetWorkspace repoints the file tools at another directory.
//
// This is deliberately not a tool: only the user, through the UI, can move the
// sandbox — a model (or a prompt injected into a page it fetched) cannot widen
// its own reach by calling it.
func (s *Server) handleSetWorkspace(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req setWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	resolved, err := tools.SetWorkspace(strings.TrimSpace(req.Path))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	slog.Info("Workspace changed", "workspace", resolved)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(describeWorkspace(resolved))
}

// SettingsResponse reports daemon-level capabilities the user controls.
type SettingsResponse struct {
	// ProjectExecution allows build and run commands (npm install, node, go test).
	ProjectExecution bool     `json:"project_execution"`
	AllowedCommands  []string `json:"allowed_commands"`
}

type setSettingsRequest struct {
	ProjectExecution *bool `json:"project_execution,omitempty"`
}

func currentSettings() SettingsResponse {
	return SettingsResponse{
		ProjectExecution: tools.ProjectExecutionEnabled(),
		AllowedCommands:  tools.AllowedCommandNames(),
	}
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(currentSettings())
}

// handleSetSettings toggles daemon capabilities.
//
// Like the workspace, this is a user action and deliberately not a tool: a model
// must not be able to grant itself the ability to run arbitrary code.
func (s *Server) handleSetSettings(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req setSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.ProjectExecution != nil {
		tools.SetProjectExecution(*req.ProjectExecution)
		slog.Warn("Project execution setting changed", "enabled", *req.ProjectExecution)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(currentSettings())
}

// ToolsResponse describes the tool surface available to a profession, along
// with the metadata the client needs to render approval prompts accurately.
type ToolsResponse struct {
	Tools           []tools.ToolDefinition `json:"tools"`
	ReadOnlyTools   map[string]bool        `json:"read_only_tools"`
	AllowedCommands []string               `json:"allowed_commands"`
}

// handleGetTools returns available tool definitions grouped by category.
func (s *Server) handleGetTools(w http.ResponseWriter, r *http.Request) {
	profession := r.URL.Query().Get("profession")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(ToolsResponse{
		Tools:           tools.GetToolsForProfession(profession, nil),
		ReadOnlyTools:   tools.ReadOnlyTools,
		AllowedCommands: tools.AllowedCommandNames(),
	})
}

type executeToolRequest struct {
	Name       string `json:"name"`
	Arguments  string `json:"arguments"`
	ToolCallID string `json:"tool_call_id,omitempty"`
}

// rateLimiter is a fixed-window counter scoped to a Server instance.
type rateLimiter struct {
	mu          sync.Mutex
	limit       int
	window      time.Duration
	count       int
	windowStart time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, windowStart: time.Now()}
}

func (rl *rateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	if now.Sub(rl.windowStart) > rl.window {
		rl.count = 0
		rl.windowStart = now
	}
	if rl.count < rl.limit {
		rl.count++
		return true
	}
	return false
}

// handleExecuteTool executes a requested tool locally and returns the result.
// This is the endpoint the client uses after a user approves a tool call.
func (s *Server) handleExecuteTool(w http.ResponseWriter, r *http.Request) {
	if !s.toolLimiter.Allow() {
		writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded, max 30 tool executions per minute")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)

	var req executeToolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if !tools.IsKnownTool(strings.TrimSpace(req.Name)) {
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("unknown tool: %q", req.Name))
		return
	}

	output, err := tools.ExecuteToolContext(r.Context(), req.Name, req.Arguments)
	result := tools.ToolResult{
		ToolCallID: req.ToolCallID,
		Name:       req.Name,
		Output:     output,
	}
	if err != nil {
		result.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(result)
}

// HealthResponse is the public health payload. AuthRequired lets a client know
// it needs a token before it starts collecting 401s on every other route.
type HealthResponse struct {
	Status       string `json:"status"`
	AuthRequired bool   `json:"auth_required"`
}

// handleHealth returns a quick health check status.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(HealthResponse{Status: "ok", AuthRequired: APIToken != ""})
}

// handleStatic serves the built frontend with SPA fallback.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	clean := filepath.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
	target := filepath.Join(s.staticDir, clean)

	if info, err := os.Stat(target); err == nil && !info.IsDir() {
		http.ServeFile(w, r, target)
		return
	}

	// Unknown paths fall back to the SPA entry point, except under /api.
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	http.ServeFile(w, r, filepath.Join(s.staticDir, "index.html"))
}

// corsMiddleware sets security headers and strictly restricts origins to prevent unauthorized web access.
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set protective security headers
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		origin := r.Header.Get("Origin")

		if origin != "" {
			if s.isAllowedOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			} else {
				// Reject unauthorized external websites trying to talk to local daemon
				writeJSONError(w, http.StatusForbidden, "forbidden: cross-origin request rejected from untrusted origin")
				return
			}
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// authMiddleware enforces the bearer token on every endpoint except /health.
//
// GETs are not exempt: /api/v1/engines and /api/v1/tools disclose the local
// model inventory and the tool surface, which is exactly what a token is meant
// to protect when one is configured.
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if APIToken == "" || r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		// Static assets are served unauthenticated so the UI can bootstrap and
		// prompt for a token; every API route below still requires one.
		if s.staticDir != "" && !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		expected := "Bearer " + APIToken
		if subtle.ConstantTimeCompare([]byte(authHeader), []byte(expected)) != 1 {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		next.ServeHTTP(w, r)
	})
}
