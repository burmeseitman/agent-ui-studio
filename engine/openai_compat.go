package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type openAICompatResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
	Models []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"models"`
}

// ProbeOpenAICompat probes an OpenAI-compatible /v1/models endpoint (LM Studio, vLLM, etc.).
func ProbeOpenAICompat(ctx context.Context, client *http.Client, baseURL string) (*EngineInfo, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	endpoint := fmt.Sprintf("%s/v1/models", baseURL)

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
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return nil, err
	}

	var parsedResp openAICompatResponse
	if err := json.Unmarshal(body, &parsedResp); err != nil {
		return nil, err
	}

	models := make([]string, 0, len(parsedResp.Data)+len(parsedResp.Models))
	for _, item := range parsedResp.Data {
		if item.ID != "" {
			models = append(models, item.ID)
		}
	}
	// Support alternate 'models' array if 'data' is empty
	if len(models) == 0 {
		for _, item := range parsedResp.Models {
			if item.ID != "" {
				models = append(models, item.ID)
			} else if item.Name != "" {
				models = append(models, item.Name)
			}
		}
	}

	return &EngineInfo{
		Name:   "lmstudio",
		URL:    baseURL,
		Active: true,
		Models: models,
	}, nil
}
