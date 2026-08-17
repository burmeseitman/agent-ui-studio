package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
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
		Name:         "ollama",
		URL:          baseURL,
		Active:       true,
		Models:       models,
		ModelDetails: describeModels(ctx, client, baseURL, models),
	}, nil
}

// detailCache memoises /api/show results. A model's capabilities do not change
// while it is installed, and discovery runs every few seconds, so fetching them
// once per daemon run keeps the scan cheap.
var (
	detailMu    sync.Mutex
	detailCache = map[string]ModelDetail{}
)

type ollamaShowResponse struct {
	Capabilities []string `json:"capabilities"`
	Details      struct {
		Family        string `json:"family"`
		ParameterSize string `json:"parameter_size"`
	} `json:"details"`
	ModelInfo map[string]any `json:"model_info"`
}

// describeModels enriches the model list with engine-reported metadata.
//
// Best-effort by design: a slow or older Ollama simply yields names with no
// details, and the client falls back to name heuristics.
func describeModels(ctx context.Context, client *http.Client, baseURL string, models []string) []ModelDetail {
	if len(models) == 0 {
		return nil
	}

	out := make([]ModelDetail, len(models))
	var wg sync.WaitGroup
	// Bounded so a machine with many models cannot fan out unboundedly.
	sem := make(chan struct{}, 6)

	for i, name := range models {
		detailMu.Lock()
		cached, ok := detailCache[name]
		detailMu.Unlock()
		if ok {
			out[i] = cached
			continue
		}

		wg.Add(1)
		go func(idx int, model string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			detail := ModelDetail{Name: model}
			if fetched, err := showModel(ctx, client, baseURL, model); err == nil {
				detail = fetched
				detailMu.Lock()
				detailCache[model] = detail
				detailMu.Unlock()
			}
			out[idx] = detail
		}(i, name)
	}

	wg.Wait()
	return out
}

func showModel(ctx context.Context, client *http.Client, baseURL, model string) (ModelDetail, error) {
	payload, err := json.Marshal(map[string]string{"model": model})
	if err != nil {
		return ModelDetail{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/show", bytes.NewReader(payload))
	if err != nil {
		return ModelDetail{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return ModelDetail{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ModelDetail{}, fmt.Errorf("show returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return ModelDetail{}, err
	}

	var show ollamaShowResponse
	if err := json.Unmarshal(body, &show); err != nil {
		return ModelDetail{}, err
	}

	detail := ModelDetail{
		Name:          model,
		Capabilities:  show.Capabilities,
		Family:        show.Details.Family,
		ParameterSize: show.Details.ParameterSize,
	}
	// The context length key is namespaced by architecture, e.g. "qwen2.context_length".
	for key, value := range show.ModelInfo {
		if strings.HasSuffix(key, ".context_length") {
			if f, ok := value.(float64); ok {
				detail.ContextLength = int(f)
			}
			break
		}
	}
	return detail, nil
}
