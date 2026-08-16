package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"testing"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newMockClient(fn roundTripperFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func TestProbeOllama_Success(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/api/tags" {
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
	})

	info, err := ProbeOllama(context.Background(), mockClient, "http://localhost:11434")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info == nil || !info.Active {
		t.Fatalf("expected active=true, got false")
	}
	expected := []string{"llama3:8b", "qwen2.5-coder:7b"}
	if !reflect.DeepEqual(info.Models, expected) {
		t.Fatalf("expected models %v, got %v", expected, info.Models)
	}
}

func TestProbeOllama_FallbackToV1Models(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/api/tags" {
			return &http.Response{
				StatusCode: http.StatusNotFound,
				Body:       io.NopCloser(bytes.NewBufferString("not found")),
				Header:     make(http.Header),
			}, nil
		}
		if req.URL.Path == "/v1/models" {
			body := `{"data": [{"id": "llama3.2:1b"}]}`
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
	})

	info, err := ProbeOllama(context.Background(), mockClient, "http://localhost:11434")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info == nil || !info.Active {
		t.Fatalf("expected active=true, got false")
	}
	expected := []string{"llama3.2:1b"}
	if !reflect.DeepEqual(info.Models, expected) {
		t.Fatalf("expected models %v, got %v", expected, info.Models)
	}
}

func TestProbeOllama_InvalidJSON(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString("invalid json")),
			Header:     make(http.Header),
		}, nil
	})

	info, err := ProbeOllama(context.Background(), mockClient, "http://localhost:11434")
	if err == nil {
		t.Fatalf("expected json parsing error, got nil")
	}
	if info != nil && info.Active {
		t.Fatalf("expected active=false, got true")
	}
}

func TestProbeOllama_NetworkError(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})

	info, err := ProbeOllama(context.Background(), mockClient, "http://localhost:11434")
	if err == nil {
		t.Fatalf("expected network error, got nil")
	}
	if info != nil && info.Active {
		t.Fatalf("expected active=false, got true")
	}
}

func TestProbeOpenAICompat_Success(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/v1/models" {
			body := `{
				"object": "list",
				"data": [
					{"id": "meta-llama-3-8b-instruct"},
					{"id": "mistral-7b-instruct"}
				]
			}`
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
	})

	info, err := ProbeOpenAICompat(context.Background(), mockClient, "http://localhost:1234")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info == nil || !info.Active {
		t.Fatalf("expected active=true, got false")
	}
	expected := []string{"meta-llama-3-8b-instruct", "mistral-7b-instruct"}
	if !reflect.DeepEqual(info.Models, expected) {
		t.Fatalf("expected models %v, got %v", expected, info.Models)
	}
}

func TestProbeOpenAICompat_ModelsArrayFallback(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/v1/models" {
			body := `{
				"models": [
					{"name": "phi-3-mini"}
				]
			}`
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
	})

	info, err := ProbeOpenAICompat(context.Background(), mockClient, "http://localhost:1234")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info == nil || !info.Active {
		t.Fatalf("expected active=true, got false")
	}
	expected := []string{"phi-3-mini"}
	if !reflect.DeepEqual(info.Models, expected) {
		t.Fatalf("expected models %v, got %v", expected, info.Models)
	}
}

func TestProbeOpenAICompat_ErrorStatus(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("internal error")),
			Header:     make(http.Header),
		}, nil
	})

	info, err := ProbeOpenAICompat(context.Background(), mockClient, "http://localhost:1234")
	if err == nil {
		t.Fatalf("expected error for status 500, got nil")
	}
	if info != nil && info.Active {
		t.Fatalf("expected active=false, got true")
	}
}

func TestProbeOpenAICompat_InvalidJSON(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString("bad-json")),
			Header:     make(http.Header),
		}, nil
	})

	info, err := ProbeOpenAICompat(context.Background(), mockClient, "http://localhost:1234")
	if err == nil {
		t.Fatalf("expected json parsing error, got nil")
	}
	if info != nil && info.Active {
		t.Fatalf("expected active=false, got true")
	}
}

func TestProbeOpenAICompat_NetworkError(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})

	info, err := ProbeOpenAICompat(context.Background(), mockClient, "http://localhost:1234")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if info != nil && info.Active {
		t.Fatalf("expected active=false, got true")
	}
}

func TestScanner_Scan(t *testing.T) {
	mockClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Host {
		case "mock-ollama:11434":
			body := `{"models": [{"name": "llama3:8b"}, {"name": "qwen2.5-coder:7b"}]}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(body)),
				Header:     make(http.Header),
			}, nil
		case "mock-lmstudio:1234":
			return nil, errors.New("connection refused: engine offline")
		default:
			return &http.Response{
				StatusCode: http.StatusNotFound,
				Body:       io.NopCloser(bytes.NewBufferString("")),
				Header:     make(http.Header),
			}, nil
		}
	})

	targets := []Target{
		{
			Name:      "ollama",
			URL:       "http://mock-ollama:11434",
			ProbeFunc: ProbeOllama,
		},
		{
			Name:      "lmstudio",
			URL:       "http://mock-lmstudio:1234",
			ProbeFunc: ProbeOpenAICompat,
		},
	}

	scanner := NewScannerWithClient(mockClient, 0, targets...)
	results := scanner.Scan()

	if len(results) != 2 {
		t.Fatalf("expected 2 engine results, got %d", len(results))
	}

	// First engine: Ollama active
	if results[0].Name != "ollama" || !results[0].Active || len(results[0].Models) != 2 {
		t.Errorf("unexpected result for ollama: %+v", results[0])
	}
	expectedOllamaModels := []string{"llama3:8b", "qwen2.5-coder:7b"}
	if !reflect.DeepEqual(results[0].Models, expectedOllamaModels) {
		t.Errorf("expected ollama models %v, got %v", expectedOllamaModels, results[0].Models)
	}

	// Second engine: LM Studio inactive
	if results[1].Name != "lmstudio" || results[1].Active || len(results[1].Models) != 0 {
		t.Errorf("unexpected result for lmstudio: %+v", results[1])
	}

	// Verify JSON serialization format matches requirement
	response := EnginesResponse{Engines: results}
	jsonBytes, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("failed to marshal EnginesResponse: %v", err)
	}

	var jsonMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &jsonMap); err != nil {
		t.Fatalf("failed to unmarshal generated json: %v", err)
	}

	enginesArray, ok := jsonMap["engines"].([]interface{})
	if !ok || len(enginesArray) != 2 {
		t.Fatalf("engines array invalid in json: %s", string(jsonBytes))
	}

	// Verify models is an array `[]`, not null
	firstEngine := enginesArray[0].(map[string]interface{})
	if firstEngine["name"] != "ollama" || firstEngine["active"] != true {
		t.Errorf("unexpected first engine JSON: %v", firstEngine)
	}

	secondEngine := enginesArray[1].(map[string]interface{})
	if secondEngine["name"] != "lmstudio" || secondEngine["active"] != false {
		t.Errorf("unexpected second engine JSON: %v", secondEngine)
	}
	modelsSlice, ok := secondEngine["models"].([]interface{})
	if !ok || len(modelsSlice) != 0 {
		t.Errorf("expected empty models array for inactive engine, got %v", secondEngine["models"])
	}
}

func TestNewScanner_DefaultOptions(t *testing.T) {
	s := NewScanner(0)
	if len(s.targets) != 2 {
		t.Fatalf("expected 2 default targets, got %d", len(s.targets))
	}
	if s.targets[0].Name != "ollama" || s.targets[1].Name != "lmstudio" {
		t.Fatalf("unexpected default targets: %+v", s.targets)
	}
}
