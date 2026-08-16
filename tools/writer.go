package tools

import (
	"context"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// isPrivateOrLoopbackIP checks if an IP address belongs to internal / private / metadata networks.
func isPrivateOrLoopbackIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	// AWS / GCP / Azure Cloud Metadata IP: 169.254.169.254
	if ip.String() == "169.254.169.254" {
		return true
	}
	return false
}

// validatePublicURL ensures the URL is public and does not point to internal/private services (anti-SSRF).
func validatePublicURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("unsupported protocol: only http and https are allowed")
	}

	host := parsed.Hostname()
	if host == "" {
		return nil, fmt.Errorf("missing host in url")
	}

	// Block direct localhost references and metadata
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".local") || strings.EqualFold(host, "metadata.google.internal") {
		return nil, fmt.Errorf("access to local/private network hosts is restricted")
	}

	return parsed, nil
}

// FetchURL downloads content from a public URL and converts HTML to clean readable text with SSRF protection.
func FetchURL(parent context.Context, targetURL string) (string, error) {
	targetURL = strings.TrimSpace(targetURL)
	if targetURL == "" {
		return "", fmt.Errorf("url cannot be empty")
	}

	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		targetURL = "https://" + targetURL
	}

	validatedURL, err := validatePublicURL(targetURL)
	if err != nil {
		return "", fmt.Errorf("security restriction: %w", err)
	}

	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, validatedURL.String(), nil)
	if err != nil {
		return "", fmt.Errorf("invalid request: %w", err)
	}
	req.Header.Set("User-Agent", "AgentUI-Studio/0.1.0 (Safe Content Agent)")

	safeTransport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}

			ips, err := net.LookupIP(host)
			if err != nil {
				return nil, fmt.Errorf("failed to resolve host: %w", err)
			}

			for _, ip := range ips {
				if isPrivateOrLoopbackIP(ip) {
					return nil, fmt.Errorf("access to internal/private IP addresses (%s) is restricted", ip.String())
				}
			}

			dialer := &net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}

			var lastErr error
			for _, ip := range ips {
				ipAddr := net.JoinHostPort(ip.String(), port)
				conn, err := dialer.DialContext(ctx, network, ipAddr)
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, fmt.Errorf("no addresses could be dialed")
		},
	}

	client := &http.Client{
		Timeout:   10 * time.Second,
		Transport: safeTransport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Validate redirect destination against SSRF
			if _, err := validatePublicURL(req.URL.String()); err != nil {
				return fmt.Errorf("redirect blocked: %w", err)
			}
			return nil
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch url: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("url returned HTTP %d", resp.StatusCode)
	}

	// Limit read to 2MB to prevent decompression / memory bombs
	limitReader := io.LimitReader(resp.Body, 2*1024*1024)
	bodyBytes, err := io.ReadAll(limitReader)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	htmlContent := string(bodyBytes)
	cleanText := htmlToCleanText(htmlContent)

	runes := []rune(cleanText)
	if len(runes) > 15000 {
		cleanText = string(runes[:15000]) + "\n\n... [article content truncated]"
	}

	return fmt.Sprintf("Source: %s\n\n%s", targetURL, cleanText), nil
}

// AnalyzeReadability calculates word count, sentence count, reading time, and estimated reading level.
func AnalyzeReadability(text string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("text cannot be empty")
	}

	// Limit text analysis length to 500,000 characters to prevent CPU DoS
	if len(text) > 500000 {
		text = text[:500000]
	}

	words := strings.Fields(text)
	wordCount := len(words)
	charCount := len([]rune(text))

	sentenceRegex := regexp.MustCompile(`[.!?]+\s+`)
	sentences := sentenceRegex.Split(text, -1)
	sentenceCount := len(sentences)
	if sentenceCount == 0 {
		sentenceCount = 1
	}

	syllableCount := 0
	syllableRegex := regexp.MustCompile(`(?i)[aeiouy]+`)
	for _, w := range words {
		matches := syllableRegex.FindAllString(w, -1)
		c := len(matches)
		if c == 0 {
			c = 1
		}
		syllableCount += c
	}

	avgWordsPerSentence := float64(wordCount) / float64(sentenceCount)
	avgSyllablesPerWord := float64(syllableCount) / math.Max(float64(wordCount), 1)

	fleschScore := 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord)
	if fleschScore > 100 {
		fleschScore = 100
	} else if fleschScore < 0 {
		fleschScore = 0
	}

	readingLevel := "Easy / Conversational"
	if fleschScore < 30 {
		readingLevel = "Very Difficult / Academic"
	} else if fleschScore < 50 {
		readingLevel = "Difficult / Professional"
	} else if fleschScore < 70 {
		readingLevel = "Standard / General Audience"
	}

	readingTimeMinutes := float64(wordCount) / 200.0
	readingTimeFormatted := fmt.Sprintf("%.1f min", readingTimeMinutes)
	if readingTimeMinutes < 1.0 {
		readingTimeFormatted = fmt.Sprintf("%d sec", int(readingTimeMinutes*60))
	}

	return fmt.Sprintf(`📊 Readability & Content Analysis:
• Word Count: %d words
• Character Count: %d characters
• Sentence Count: %d sentences
• Avg Words per Sentence: %.1f
• Est. Reading Time: %s
• Flesch Reading Ease: %.1f / 100 (%s)`,
		wordCount,
		charCount,
		sentenceCount,
		avgWordsPerSentence,
		readingTimeFormatted,
		fleschScore,
		readingLevel,
	), nil
}

// htmlToCleanText strips HTML tags, scripts, and extra whitespace safely.
func htmlToCleanText(html string) string {
	scriptRegex := regexp.MustCompile(`(?is)<script.*?>.*?</script>`)
	styleRegex := regexp.MustCompile(`(?is)<style.*?>.*?</style>`)
	cleaned := scriptRegex.ReplaceAllString(html, "")
	cleaned = styleRegex.ReplaceAllString(cleaned, "")

	tagNewlineRegex := regexp.MustCompile(`(?i)<(br|p|div|h[1-6]|li)[^>]*>`)
	cleaned = tagNewlineRegex.ReplaceAllString(cleaned, "\n")

	tagRegex := regexp.MustCompile(`<[^>]+>`)
	cleaned = tagRegex.ReplaceAllString(cleaned, " ")

	cleaned = strings.ReplaceAll(cleaned, "&nbsp;", " ")
	cleaned = strings.ReplaceAll(cleaned, "&amp;", "&")
	cleaned = strings.ReplaceAll(cleaned, "&lt;", "<")
	cleaned = strings.ReplaceAll(cleaned, "&gt;", ">")
	cleaned = strings.ReplaceAll(cleaned, "&quot;", "\"")

	lines := strings.Split(cleaned, "\n")
	var nonBlankLines []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" {
			nonBlankLines = append(nonBlankLines, trimmed)
		}
	}

	return strings.Join(nonBlankLines, "\n\n")
}
