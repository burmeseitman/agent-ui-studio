package engine

import (
	"context"
	"net/http"
)

// EngineInfo holds detected status and model list for an AI engine.
type EngineInfo struct {
	Name   string   `json:"name"`
	URL    string   `json:"url"`
	Active bool     `json:"active"`
	Models []string `json:"models"`
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
