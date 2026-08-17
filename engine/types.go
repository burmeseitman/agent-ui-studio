package engine

import (
	"context"
	"net/http"
)

// ModelDetail carries what the engine knows about a model, so the client can
// choose sensibly instead of guessing from the name.
type ModelDetail struct {
	Name string `json:"name"`
	// Capabilities comes from the engine itself ("tools", "vision", "completion").
	// It is the only reliable way to know whether a model can call tools at all.
	Capabilities  []string `json:"capabilities,omitempty"`
	Family        string   `json:"family,omitempty"`
	ParameterSize string   `json:"parameter_size,omitempty"`
	ContextLength int      `json:"context_length,omitempty"`
	SizeBytes     int64    `json:"size_bytes,omitempty"`
}

// SupportsTools reports whether the engine advertises tool calling.
func (m ModelDetail) SupportsTools() bool {
	for _, c := range m.Capabilities {
		if c == "tools" {
			return true
		}
	}
	return false
}

// EngineInfo holds detected status and model list for an AI engine.
type EngineInfo struct {
	Name   string   `json:"name"`
	URL    string   `json:"url"`
	Active bool     `json:"active"`
	Models []string `json:"models"`
	// ModelDetails is best-effort: engines that expose no metadata simply omit it.
	ModelDetails []ModelDetail `json:"model_details,omitempty"`
}

// EnginesResponse represents the unified response format for engine discovery.
type EnginesResponse struct {
	Engines []EngineInfo `json:"engines"`
}

// ProbeFunc is a function signature for probing an engine and returning its active status and models.
type ProbeFunc func(ctx context.Context, client *http.Client, baseURL string) (*EngineInfo, error)

// Target defines an engine endpoint configuration for scanning.
type Target struct {
	Name      string
	URL       string
	ProbeFunc ProbeFunc
}
