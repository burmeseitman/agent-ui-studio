package tools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// WorkspaceRoot is the root directory for sandboxed operations.
var WorkspaceRoot string

func init() {
	if wd, err := os.Getwd(); err == nil {
		WorkspaceRoot = wd
	}
}

const (
	commandTimeout    = 15 * time.Second
	maxCommandOutput  = 10000
	maxFileReadOutput = 20000
)

// sensitiveBasenames and sensitiveDirs are a defence-in-depth layer on top of
// the workspace boundary: even inside the project, credentials stay unreadable.
var sensitiveDirs = map[string]bool{
	".ssh": true, ".aws": true, ".gnupg": true, ".config/gcloud": true,
}

func isSensitiveName(name string) bool {
	switch {
	case strings.HasPrefix(name, ".env"):
		return true
	case name == "id_rsa", name == "id_ed25519", name == "id_ecdsa", name == "id_dsa":
		return true
	case name == ".npmrc", name == ".netrc", name == ".gitcredentials", name == ".pypirc":
		return true
	case strings.HasSuffix(name, ".pem"), strings.HasSuffix(name, ".key"),
		strings.HasSuffix(name, ".p12"), strings.HasSuffix(name, ".pfx"):
		return true
	}
	return false
}

// resolveExisting resolves symlinks on the longest existing prefix of path and
// re-appends the remainder verbatim.
//
// filepath.EvalSymlinks fails outright on paths that do not exist yet, which is
// the normal case for write_file. Resolving only the existing prefix still
// closes the escape: every directory that could carry a symlink is resolved,
// and the unresolved tail cannot itself be a link because it does not exist.
func resolveExisting(path string) (string, error) {
	cur := filepath.Clean(path)
	remainder := ""

	for {
		resolved, err := filepath.EvalSymlinks(cur)
		if err == nil {
			if remainder == "" {
				return resolved, nil
			}
			return filepath.Join(resolved, remainder), nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("failed to resolve path: %w", err)
		}

		parent := filepath.Dir(cur)
		if parent == cur {
			// Reached the filesystem root without finding anything that exists.
			return filepath.Clean(path), nil
		}
		remainder = filepath.Join(filepath.Base(cur), remainder)
		cur = parent
	}
}

// sanitizeWorkspacePath resolves a caller-supplied path and guarantees the
// result is inside the workspace root, with symlinks resolved on both sides so
// a link inside the project cannot be used to reach outside it.
func sanitizeWorkspacePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("path cannot be empty")
	}

	workspaceRoot := WorkspaceRoot
	if workspaceRoot == "" {
		wd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("failed to determine workspace directory: %w", err)
		}
		workspaceRoot = wd
	}
	if resolved, err := filepath.EvalSymlinks(workspaceRoot); err == nil {
		workspaceRoot = resolved
	} else {
		workspaceRoot, _ = filepath.Abs(workspaceRoot)
	}

	targetPath := path
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(workspaceRoot, targetPath)
	}
	targetPath = filepath.Clean(targetPath)

	// Resolve symlinks before the containment check, otherwise a link inside
	// the workspace pointing at /etc or ~/.ssh would pass it.
	resolvedTarget, err := resolveExisting(targetPath)
	if err != nil {
		return "", err
	}

	rel, err := filepath.Rel(workspaceRoot, resolvedTarget)
	if err != nil {
		return "", fmt.Errorf("access denied: path %q escapes project workspace boundary", path)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("access denied: path %q escapes project workspace boundary", path)
	}

	// Inspect every component of the resolved path, not just the basename.
	for _, part := range strings.Split(rel, string(os.PathSeparator)) {
		if part == "." || part == "" {
			continue
		}
		if sensitiveDirs[part] || isSensitiveName(part) {
			return "", fmt.Errorf("access denied: reading sensitive credentials is restricted")
		}
	}

	return resolvedTarget, nil
}

// cappedBuffer collects output up to a byte ceiling, discarding the rest. It
// bounds memory for commands that produce unbounded output.
type cappedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if remaining := c.limit - c.buf.Len(); remaining > 0 {
		if len(p) > remaining {
			c.buf.Write(p[:remaining])
			c.truncated = true
		} else {
			c.buf.Write(p)
		}
	} else if len(p) > 0 {
		c.truncated = true
	}
	return len(p), nil
}

func (c *cappedBuffer) String() string { return c.buf.String() }
func (c *cappedBuffer) Len() int       { return c.buf.Len() }

// commandEnv builds a minimal environment for child processes so that secrets
// held in the daemon's environment (cloud credentials, API tokens) are not
// inherited by model-triggered commands.
func commandEnv() []string {
	env := []string{"LANG=C", "TERM=dumb"}
	passthrough := []string{
		"PATH", "HOME", "USER", "SHELL", "TMPDIR",
		"GOPATH", "GOROOT", "GOCACHE", "GOMODCACHE", "GOFLAGS",
	}
	for _, key := range passthrough {
		if val, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+val)
		}
	}
	return env
}

func truncateString(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) > maxLen {
		return string(runes[:maxLen])
	}
	return s
}

// ExecuteCommand runs an allowlisted command without a shell.
//
// The command string is parsed into argv, checked against the policy in
// exec_policy.go, and executed directly. No shell is involved at any point, so
// substitution, redirection, chaining and globbing are not interpreted.
func ExecuteCommand(ctx context.Context, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", fmt.Errorf("command cannot be empty")
	}

	argv, err := parseArgv(command)
	if err != nil {
		return "", err
	}
	if err := checkCommandPolicy(argv); err != nil {
		return "", err
	}

	workDir := WorkspaceRoot
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	execCtx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(execCtx, argv[0], argv[1:]...)
	cmd.Dir = workDir
	cmd.Env = commandEnv()
	cmd.Stdin = nil

	stdout := &cappedBuffer{limit: maxCommandOutput * 4}
	stderr := &cappedBuffer{limit: maxCommandOutput * 4}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	runErr := cmd.Run()

	output := stdout.String()
	if stderr.Len() > 0 {
		if output != "" {
			output += "\n"
		}
		output += "STDERR:\n" + stderr.String()
	}

	if errors.Is(execCtx.Err(), context.DeadlineExceeded) {
		return output, fmt.Errorf("command timed out after %s", commandTimeout)
	}
	if errors.Is(execCtx.Err(), context.Canceled) {
		return output, fmt.Errorf("command cancelled")
	}
	if runErr != nil && output == "" {
		return "", fmt.Errorf("command execution failed: %w", runErr)
	}

	truncated := truncateString(output, maxCommandOutput)
	if len(truncated) < len(output) || stdout.truncated || stderr.truncated {
		output = truncated + "\n... [truncated output]"
	} else {
		output = truncated
	}

	return output, nil
}

// ReadFile reads the contents of a local file within the workspace boundary.
func ReadFile(path string) (string, error) {
	safePath, err := sanitizeWorkspacePath(path)
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(safePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}

	content := string(data)
	truncated := truncateString(content, maxFileReadOutput)
	if len(truncated) < len(content) {
		content = truncated + "\n... [truncated content]"
	} else {
		content = truncated
	}

	return content, nil
}

// WriteFile writes content to a target file strictly within the workspace boundary.
func WriteFile(path string, content string) (string, error) {
	safePath, err := sanitizeWorkspacePath(path)
	if err != nil {
		return "", err
	}

	dir := filepath.Dir(safePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create parent directories: %w", err)
	}

	if err := os.WriteFile(safePath, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return fmt.Sprintf("Successfully wrote %d bytes to %s", len(content), filepath.Base(safePath)), nil
}

// ListDir lists entries in a directory strictly within the workspace boundary.
func ListDir(path string) (string, error) {
	safePath, err := sanitizeWorkspacePath(path)
	if err != nil {
		return "", err
	}

	entries, err := os.ReadDir(safePath)
	if err != nil {
		return "", fmt.Errorf("failed to list directory: %w", err)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Directory listing for %s:\n", filepath.Base(safePath)))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		typeChar := "F"
		if entry.IsDir() {
			typeChar = "D"
		}
		sb.WriteString(fmt.Sprintf("[%s] %-25s %8d bytes\n", typeChar, entry.Name(), info.Size()))
	}

	return sb.String(), nil
}
