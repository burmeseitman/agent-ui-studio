package adapter

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"reflect"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newMockClient(fn roundTripperFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func TestStreamOllama_Success(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/chat" {
			return &http.Response{StatusCode: http.StatusNotFound}, nil
		}

		ndjson := `{"model":"llama3:8b","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama3:8b","message":{"role":"assistant","content":" world!"},"done":false}
{"model":"llama3:8b","message":{"role":"assistant","content":""},"done":true}
`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(ndjson)),
			Header:     make(http.Header),
		}, nil
	})

	temp := 0.7
	maxTokens := 100
	req := &ChatCompletionRequest{
		Engine:      "ollama",
		Model:       "llama3:8b",
		Messages:    []ChatMessage{{Role: "user", Content: "hi"}},
		Temperature: &temp,
		MaxTokens:   &maxTokens,
	}

	var collectedTokens []string
	var finishReasons []string

	_, err := StreamOllama(context.Background(), mockClient, "http://mock-ollama:11434", req, func(chunk *ChatCompletionChunk) error {
		if len(chunk.Choices) > 0 {
			if chunk.Choices[0].Delta.Content != "" {
				collectedTokens = append(collectedTokens, chunk.Choices[0].Delta.Content)
			}
			if chunk.Choices[0].FinishReason != nil {
				finishReasons = append(finishReasons, *chunk.Choices[0].FinishReason)
			}
		}
		return nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedTokens := []string{"Hello", " world!"}
	if !reflect.DeepEqual(collectedTokens, expectedTokens) {
		t.Fatalf("expected tokens %v, got %v", expectedTokens, collectedTokens)
	}

	if len(finishReasons) != 1 || finishReasons[0] != "stop" {
		t.Fatalf("expected stop finish reason, got %v", finishReasons)
	}
}

func TestStreamOllama_ErrorResponse(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Body:       io.NopCloser(bytes.NewBufferString(`model 'unknown' not found`)),
			Header:     make(http.Header),
		}, nil
	})

	req := &ChatCompletionRequest{
		Model:    "unknown",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}

	_, err := StreamOllama(context.Background(), mockClient, "http://mock-ollama:11434", req, func(chunk *ChatCompletionChunk) error {
		return nil
	})

	if err == nil {
		t.Fatalf("expected error from 404 response, got nil")
	}
}

func TestStreamOpenAICompat_Success(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v1/chat/completions" {
			return &http.Response{StatusCode: http.StatusNotFound}, nil
		}

		sseStream := `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Deep"}}]}

data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Seek"}}]}

data: [DONE]
`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(sseStream)),
			Header:     make(http.Header),
		}, nil
	})

	req := &ChatCompletionRequest{
		Engine:   "lmstudio",
		Model:    "deepseek-r1",
		Messages: []ChatMessage{{Role: "user", Content: "explain quantum"}},
	}

	var collectedTokens []string
	_, err := StreamOpenAICompat(context.Background(), mockClient, "http://mock-lmstudio:1234", req, func(chunk *ChatCompletionChunk) error {
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			collectedTokens = append(collectedTokens, chunk.Choices[0].Delta.Content)
		}
		return nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedTokens := []string{"Deep", "Seek"}
	if !reflect.DeepEqual(collectedTokens, expectedTokens) {
		t.Fatalf("expected tokens %v, got %v", expectedTokens, collectedTokens)
	}
}

func TestStreamOpenAICompat_ErrorResponse(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString(`internal server error`)),
			Header:     make(http.Header),
		}, nil
	})

	req := &ChatCompletionRequest{
		Model:    "test",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}

	_, err := StreamOpenAICompat(context.Background(), mockClient, "http://mock-lmstudio:1234", req, func(chunk *ChatCompletionChunk) error {
		return nil
	})

	if err == nil {
		t.Fatalf("expected error from 500 response, got nil")
	}
}

func TestRouter_RoutingAndValidation(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Host {
		case "mock-ollama:11434":
			ndjson := `{"model":"llama3:8b","message":{"content":"from ollama"},"done":true}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(ndjson)),
				Header:     make(http.Header),
			}, nil
		case "mock-lmstudio:1234":
			sse := `data: {"id":"1","choices":[{"delta":{"content":"from lmstudio"}}]}

data: [DONE]
`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(sse)),
				Header:     make(http.Header),
			}, nil
		default:
			return nil, errors.New("unknown host")
		}
	})

	router := NewRouter(mockClient, "http://mock-ollama:11434", "http://mock-lmstudio:1234")

	// 1. Validation: Missing model
	_, err := router.Stream(context.Background(), &ChatCompletionRequest{}, func(chunk *ChatCompletionChunk) error { return nil })
	if err == nil {
		t.Fatal("expected error for missing model")
	}

	// 2. Validation: Empty messages
	_, err = router.Stream(context.Background(), &ChatCompletionRequest{Model: "llama3:8b"}, func(chunk *ChatCompletionChunk) error { return nil })
	if err == nil {
		t.Fatal("expected error for empty messages")
	}

	// 3. Validation: Unsupported engine
	_, err = router.Stream(context.Background(), &ChatCompletionRequest{
		Engine:   "unsupported-engine",
		Model:    "llama3:8b",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(chunk *ChatCompletionChunk) error { return nil })
	if err == nil {
		t.Fatal("expected error for unsupported engine")
	}

	// 4. Default to Ollama when engine is empty
	var ollamaContent string
	_, err = router.Stream(context.Background(), &ChatCompletionRequest{
		Model:    "llama3:8b",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(chunk *ChatCompletionChunk) error {
		if len(chunk.Choices) > 0 {
			ollamaContent += chunk.Choices[0].Delta.Content
		}
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ollamaContent != "from ollama" {
		t.Fatalf("expected 'from ollama', got %q", ollamaContent)
	}

	// 5. Explicit LM Studio routing
	var lmContent string
	_, err = router.Stream(context.Background(), &ChatCompletionRequest{
		Engine:   "lmstudio",
		Model:    "mistral",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(chunk *ChatCompletionChunk) error {
		if len(chunk.Choices) > 0 {
			lmContent += chunk.Choices[0].Delta.Content
		}
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if lmContent != "from lmstudio" {
		t.Fatalf("expected 'from lmstudio', got %q", lmContent)
	}
}

func TestRouter_ContextCancellation(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		<-req.Context().Done()
		return nil, req.Context().Err()
	})

	router := NewRouter(mockClient, "http://localhost:11434", "http://localhost:1234")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, err := router.Stream(ctx, &ChatCompletionRequest{
		Engine:   "ollama",
		Model:    "llama3:8b",
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}, func(chunk *ChatCompletionChunk) error {
		return nil
	})

	if err == nil {
		t.Fatal("expected error on context cancellation")
	}
}
