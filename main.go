package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"agentui-daemon/adapter"
	"agentui-daemon/api"
	"agentui-daemon/engine"
	"agentui-daemon/tools"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	port := flag.Int("port", 8080, "Port to run the AgentUI daemon on")
	timeoutMs := flag.Int("timeout", 1500, "Discovery probe timeout in milliseconds")
	ollamaURL := flag.String("ollama-url", "http://localhost:11434", "Ollama API base URL")
	lmStudioURL := flag.String("lmstudio-url", "http://localhost:1234", "LM Studio API base URL")
	apiToken := flag.String("api-token", "", "API Token for authentication (optional, default: local zero-config mode)")
	exitOnStdinClose := flag.Bool("shutdown-on-stdin-close", false,
		"Shut down when stdin reaches EOF. Set by the desktop app so the daemon cannot outlive a force-quit.")
	workspace := flag.String("workspace", "", "Root directory tools may read and write (default: current directory)")
	staticDir := flag.String("static-dir", "web/dist", "Directory containing the built frontend to serve (empty to disable)")
	flag.Parse()

	if envPort := os.Getenv("PORT"); envPort != "" {
		var p int
		if _, err := fmt.Sscanf(envPort, "%d", &p); err == nil {
			*port = p
		}
	}

	if *port <= 0 || *port > 65535 {
		slog.Warn("Invalid port number, falling back to default 8080", "port", *port)
		*port = 8080
	}

	if envOllama := os.Getenv("OLLAMA_URL"); envOllama != "" {
		*ollamaURL = envOllama
	}
	if envLMStudio := os.Getenv("LMSTUDIO_URL"); envLMStudio != "" {
		*lmStudioURL = envLMStudio
	}

	token := *apiToken
	if token == "" {
		token = os.Getenv("AGENTUI_TOKEN")
	}

	if token != "" {
		api.APIToken = token
		slog.Info("🔐 API Token Authentication enabled", "token_configured", true)
	} else {
		api.APIToken = ""
		slog.Info("🔓 Running in Local Zero-Config Mode (trusted localhost)")
	}

	if *workspace != "" {
		abs, err := filepath.Abs(*workspace)
		if err != nil {
			slog.Error("Invalid workspace path", "path", *workspace, "error", err)
			os.Exit(1)
		}
		if info, err := os.Stat(abs); err != nil || !info.IsDir() {
			slog.Error("Workspace path is not a directory", "path", abs)
			os.Exit(1)
		}
		tools.WorkspaceRoot = abs
	}
	slog.Info("Tool sandbox root", "workspace", tools.WorkspaceRoot)

	targets := []engine.Target{
		{
			Name:      "ollama",
			URL:       *ollamaURL,
			ProbeFunc: engine.ProbeOllama,
		},
		{
			Name:      "lmstudio",
			URL:       *lmStudioURL,
			ProbeFunc: engine.ProbeOpenAICompat,
		},
	}

	scanner := engine.NewScanner(time.Duration(*timeoutMs)*time.Millisecond, targets...)
	router := adapter.NewRouter(nil, *ollamaURL, *lmStudioURL)
	server := api.NewServer(scanner, router)
	server.ServeStaticFrom(*staticDir)

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", *port),
		Handler:           server.Handler(),
		ReadHeaderTimeout: 20 * time.Second,
		ReadTimeout:       0, // Streaming requests need no arbitrary read body timeout
		WriteTimeout:      0, // Streaming responses require no write timeout
		IdleTimeout:       120 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// The desktop app kills the daemon on a clean exit, but a force-quit or a
	// crash never runs that handler and would strand this process holding a port
	// and the user's workspace. The parent's stdin pipe closes whatever way it
	// dies, so EOF here is a reliable "parent is gone" signal.
	if *exitOnStdinClose {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			slog.Info("Parent process closed stdin, shutting down")
			stop <- syscall.SIGTERM
		}()
	}

	go func() {
		slog.Info("AgentUI Studio Daemon running", "port", *port)
		slog.Info("Configured engines", "ollama", *ollamaURL, "lmstudio", *lmStudioURL)
		slog.Info("Endpoints available",
			"discovery", fmt.Sprintf("GET http://localhost:%d/api/v1/engines", *port),
			"chat_sse", fmt.Sprintf("POST http://localhost:%d/api/v1/chat/completions", *port),
			"health", fmt.Sprintf("GET http://localhost:%d/health", *port),
		)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("Fatal server error", "error", err)
			os.Exit(1)
		}
	}()

	<-stop
	slog.Info("Shutting down AgentUI Studio Daemon...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Warn("Server shutdown warning", "error", err)
	}

	slog.Info("AgentUI Studio Daemon stopped cleanly")
}
