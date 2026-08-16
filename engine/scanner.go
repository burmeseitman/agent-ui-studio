package engine

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// DefaultTargets returns the standard local AI engines to auto-discover.
func DefaultTargets() []Target {
	return []Target{
		{
			Name:      "ollama",
			URL:       "http://localhost:11434",
			ProbeFunc: ProbeOllama,
		},
		{
			Name:      "lmstudio",
			URL:       "http://localhost:1234",
			ProbeFunc: ProbeOpenAICompat,
		},
	}
}

// Scanner handles auto-discovery for configured AI engine targets.
type Scanner struct {
	client  *http.Client
	targets []Target
	timeout time.Duration
}

// NewScanner creates a new Scanner instance with default or custom targets.
func NewScanner(timeout time.Duration, targets ...Target) *Scanner {
	if timeout <= 0 {
		timeout = 1500 * time.Millisecond
	}
	return NewScannerWithClient(&http.Client{Timeout: timeout}, timeout, targets...)
}

// NewScannerWithClient creates a Scanner with a custom http.Client and target list.
func NewScannerWithClient(client *http.Client, timeout time.Duration, targets ...Target) *Scanner {
	if client == nil {
		client = &http.Client{Timeout: 1500 * time.Millisecond}
	}
	if len(targets) == 0 {
		targets = DefaultTargets()
	}

	return &Scanner{
		client:  client,
		targets: targets,
		timeout: timeout,
	}
}

// Scan probes all targets in parallel and returns their discovery status and models.
func (s *Scanner) Scan() []EngineInfo {
	results := make([]EngineInfo, len(s.targets))
	var wg sync.WaitGroup

	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()

	for i, target := range s.targets {
		wg.Add(1)
		go func(idx int, t Target) {
			defer wg.Done()

			info := EngineInfo{
				Name:   t.Name,
				URL:    t.URL,
				Active: false,
				Models: []string{},
			}

			probeInfo, err := t.ProbeFunc(ctx, s.client, t.URL)
			if err != nil {
				slog.Debug("probe failed", "engine", target.Name, "error", err)
			} else if probeInfo != nil && probeInfo.Active {
				info.Active = true
				if probeInfo.Models != nil {
					info.Models = probeInfo.Models
				}
			}

			results[idx] = info
		}(i, target)
	}

	wg.Wait()
	return results
}
