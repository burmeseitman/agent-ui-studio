package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type ollamaTagsResponse struct {
	Models []struct {
		Name  string `json:"name"`
		Model string `json:"model"`
	} `json:"models"`
}

// ProbeOllama checks if Ollama is active on the given baseURL and extracts available models.
func ProbeOllama(ctx context.Context, client *http.Client, baseURL string) (*EngineInfo, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	endpoint := fmt.Sprintf("%s/api/tags", baseURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Attempt fallback to OpenAI compatible /v1/models if /api/tags returns non-200
		return ProbeOpenAICompat(ctx, client, baseURL)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return nil, err
	}

	var tagsResp ollamaTagsResponse
	if err := json.Unmarshal(body, &tagsResp); err != nil {
		return nil, err
	}

	models := make([]string, 0, len(tagsResp.Models))
	for _, m := range tagsResp.Models {
		if m.Name != "" {
			models = append(models, m.Name)
		} else if m.Model != "" {
			models = append(models, m.Model)
		}
	}

	return &EngineInfo{
		Name:   "ollama",
		URL:    baseURL,
		Active: true,
		Models: models,
	}, nil
}
