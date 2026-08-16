package adapter

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// Router routes chat completion streaming requests to appropriate engine adapters.
type Router struct {
	client      *http.Client
	OllamaURL   string
	LMStudioURL string
}

// NewRouter creates a new Router with configured engine URLs and streaming-optimized HTTP client.
func NewRouter(client *http.Client, ollamaURL, lmStudioURL string) *Router {
	if client == nil {
		client = &http.Client{
			// Timeout must be 0 for streaming so long generations are never aborted mid-stream.
			Timeout: 0,
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment,
				DialContext: (&net.Dialer{
					Timeout:   30 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				ForceAttemptHTTP2:     true,
				MaxIdleConns:          100,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   10 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
				// Give Ollama/LM Studio up to 3 minutes to load heavy GGUF models into VRAM and send first header.
				ResponseHeaderTimeout: 3 * time.Minute,
			},
		}
	}
	if ollamaURL == "" {
		ollamaURL = "http://localhost:11434"
	}
	if lmStudioURL == "" {
		lmStudioURL = "http://localhost:1234"
	}

	return &Router{
		client:      client,
		OllamaURL:   ollamaURL,
		LMStudioURL: lmStudioURL,
	}
}

// Stream routes the chat completion request to the corresponding engine and
// streams chunks, returning what the completed turn produced.
func (r *Router) Stream(ctx context.Context, req *ChatCompletionRequest, handler ChunkHandler) (*StreamResult, error) {
	if req.Model == "" {
		return nil, fmt.Errorf("model is required")
	}
	if len(req.Messages) == 0 {
		return nil, fmt.Errorf("messages cannot be empty")
	}

	engineName := strings.ToLower(strings.TrimSpace(req.Engine))

	// If engine is not explicitly specified, default to ollama or detect from model prefix
	if engineName == "" {
		engineName = "ollama"
	}

	switch engineName {
	case "ollama":
		return StreamOllama(ctx, r.client, r.OllamaURL, req, handler)
	case "lmstudio", "lm_studio", "lm-studio", "openai", "vllm":
		return StreamOpenAICompat(ctx, r.client, r.LMStudioURL, req, handler)
	default:
		return nil, fmt.Errorf("unsupported engine: %q (supported: ollama, lmstudio, lm_studio, lm-studio, openai, vllm)", req.Engine)
	}
}
