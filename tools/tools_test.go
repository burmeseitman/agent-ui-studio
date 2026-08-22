package tools

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestGetToolsForProfession(t *testing.T) {
	devTools := GetToolsForProfession("developer", nil)
	if len(devTools) == 0 {
		t.Fatal("expected developer tools, got 0")
	}

	hasExec := false
	for _, tool := range devTools {
		if tool.Function.Name == "execute_command" {
			hasExec = true
			break
		}
	}
	if !hasExec {
		t.Fatal("developer tools missing execute_command")
	}

	writerTools := GetToolsForProfession("writer", nil)
	hasReadability := false
	for _, tool := range writerTools {
		if tool.Function.Name == "analyze_readability" {
			hasReadability = true
			break
		}
	}
	if !hasReadability {
		t.Fatal("writer tools missing analyze_readability")
	}

	customTools := GetToolsForProfession("custom", []string{"fetch_url", "read_file"})
	if len(customTools) != 2 {
		t.Fatalf("expected 2 custom tools, got %d", len(customTools))
	}
}

func TestExecuteTool_Developer(t *testing.T) {
	// 1. Write file inside workspace
	out, err := ExecuteTool("write_file", `{"path":"sample_test.txt","content":"Hello AgentUI Security"}`)
	if err != nil {
		t.Fatalf("write_file failed: %v", err)
	}
	defer os.Remove("sample_test.txt")

	if !strings.Contains(out, "Successfully wrote") {
		t.Fatalf("unexpected write_file output: %s", out)
	}

	// 2. Read file
	readOut, err := ExecuteTool("read_file", `{"path":"sample_test.txt"}`)
	if err != nil {
		t.Fatalf("read_file failed: %v", err)
	}
	if readOut != "Hello AgentUI Security" {
		t.Fatalf("expected 'Hello AgentUI Security', got %q", readOut)
	}

	// 3. List dir
	listOut, err := ExecuteTool("list_dir", `{"path":"."}`)
	if err != nil {
		t.Fatalf("list_dir failed: %v", err)
	}
	if !strings.Contains(listOut, "sample_test.txt") {
		t.Fatalf("expected list_dir to contain sample_test.txt, got %s", listOut)
	}

	// 4. Execute safe command
	if runtime.GOOS == "windows" {
		cmdOut, err := ExecuteTool("execute_command", `{"command":"git version"}`)
		if err != nil {
			t.Fatalf("execute_command failed: %v", err)
		}
		if !strings.Contains(cmdOut, "git version") {
			t.Fatalf("expected git version output, got %q", cmdOut)
		}
	} else {
		echoOut, err := ExecuteTool("execute_command", `{"command":"echo 'agent test'"}`)
		if err != nil {
			t.Fatalf("execute_command failed: %v", err)
		}
		if !strings.Contains(echoOut, "agent test") {
			t.Fatalf("expected echo output, got %q", echoOut)
		}
	}
}

func TestSecurity_PathTraversalBlocked(t *testing.T) {
	// Attempt to read outside workspace (e.g. /etc/passwd or ../../)
	_, err := ExecuteTool("read_file", `{"path":"../../../../etc/passwd"}`)
	if err == nil {
		t.Fatal("expected path traversal to be blocked, but succeeded")
	}
	if !strings.Contains(err.Error(), "escapes project workspace boundary") {
		t.Fatalf("unexpected error message: %v", err)
	}

	// Attempt to write outside workspace
	_, err = ExecuteTool("write_file", `{"path":"/tmp/malicious_escape.txt","content":"escaped"}`)
	if err == nil {
		t.Fatal("expected writing outside workspace to be blocked, but succeeded")
	}
}

func TestSecurity_DestructiveCommandBlocked(t *testing.T) {
	// Attempt to execute destructive command
	_, err := ExecuteTool("execute_command", `{"command":"rm -rf /"}`)
	if err == nil {
		t.Fatal("expected destructive command to be blocked, but succeeded")
	}
	if !strings.Contains(err.Error(), "security violation") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestSecurity_SSRFBlocked(t *testing.T) {
	// Attempt to fetch localhost / loopback
	_, err := ExecuteTool("fetch_url", `{"url":"http://127.0.0.1:8080/api/v1/engines"}`)
	if err == nil {
		t.Fatal("expected internal loopback fetch to be blocked by anti-SSRF, but succeeded")
	}
	if !strings.Contains(err.Error(), "restricted") {
		t.Fatalf("unexpected error message: %v", err)
	}

	// Attempt to fetch cloud metadata
	_, err = ExecuteTool("fetch_url", `{"url":"http://169.254.169.254/latest/meta-data"}`)
	if err == nil {
		t.Fatal("expected cloud metadata fetch to be blocked by anti-SSRF, but succeeded")
	}
}

func TestExecuteTool_Readability(t *testing.T) {
	sampleArticle := "AgentUI Studio is a powerful developer workspace. It connects local AI engines and streams tokens in real-time. It is built for speed and privacy."
	out, err := ExecuteTool("analyze_readability", `{"text":"`+sampleArticle+`"}`)
	if err != nil {
		t.Fatalf("analyze_readability failed: %v", err)
	}
	if !strings.Contains(out, "Word Count") || !strings.Contains(out, "Flesch Reading Ease") {
		t.Fatalf("unexpected readability analysis output:\n%s", out)
	}
}
