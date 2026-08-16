package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSecurity_ShellEscapesBlocked covers the bypasses that the previous
// delimiter-splitting allowlist let through: every one of these begins with an
// allowlisted binary but smuggles a second command past the check.
func TestSecurity_ShellEscapesBlocked(t *testing.T) {
	cases := []struct {
		name    string
		command string
	}{
		{"newline chaining", "ls\nwhoami"},
		{"carriage return chaining", "ls\rwhoami"},
		{"command substitution", "echo $(whoami)"},
		{"backtick substitution", "echo `whoami`"},
		{"variable expansion", "echo $HOME"},
		{"pipe", "ls | sh"},
		{"semicolon", "ls; rm -rf /"},
		{"and chaining", "ls && curl http://evil.example"},
		{"or chaining", "ls || curl http://evil.example"},
		{"output redirection", "echo pwned > /tmp/pwned"},
		{"append redirection", "echo pwned >> ~/.zshrc"},
		{"input redirection", "cat < /etc/passwd"},
		{"background", "ls &"},
		{"subshell", "(whoami)"},
		{"brace expansion", "echo {a,b}"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := ExecuteCommand(context.Background(), tc.command)
			if err == nil {
				t.Fatalf("expected %q to be rejected, got output: %q", tc.command, out)
			}
			if !strings.Contains(err.Error(), "security violation") {
				t.Fatalf("expected a security violation for %q, got: %v", tc.command, err)
			}
		})
	}
}

func TestSecurity_DisallowedBinaries(t *testing.T) {
	for _, command := range []string{
		"rm -rf /",
		"curl http://evil.example",
		"python -c 'import os'",
		"node -e 'process.exit()'",
		"bash -c whoami",
		"sh -c whoami",
		"make install",
		"docker run alpine",
		"/bin/ls",
		"./agentui-daemon",
	} {
		if _, err := ExecuteCommand(context.Background(), command); err == nil {
			t.Fatalf("expected %q to be rejected", command)
		}
	}
}

func TestSecurity_DangerousSubcommandsAndFlags(t *testing.T) {
	cases := []string{
		// git subcommands that mutate or run configured helper programs.
		"git push origin main",
		"git config core.pager evil",
		"git -c core.pager=evil log",
		"git --exec-path=/tmp log",
		// go subcommands that execute code.
		"go run main.go",
		"go test ./...",
		"go generate ./...",
		"go build -toolexec=/tmp/evil ./...",
		// npm lifecycle scripts.
		"npm run build",
		"npm install",
		"npm exec something",
		// find primaries that execute or delete.
		"find . -exec rm {} ;",
		"find . -delete",
	}

	for _, command := range cases {
		if _, err := ExecuteCommand(context.Background(), command); err == nil {
			t.Fatalf("expected %q to be rejected", command)
		}
	}
}

func TestExecuteCommand_AllowedStillWork(t *testing.T) {
	out, err := ExecuteCommand(context.Background(), "echo 'agent test'")
	if err != nil {
		t.Fatalf("echo failed: %v", err)
	}
	if !strings.Contains(out, "agent test") {
		t.Fatalf("unexpected echo output: %q", out)
	}

	// Quoted metacharacters are literal data, not shell syntax.
	out, err = ExecuteCommand(context.Background(), `echo "a|b;c"`)
	if err != nil {
		t.Fatalf("quoted metacharacters should be allowed as literals: %v", err)
	}
	if !strings.Contains(out, "a|b;c") {
		t.Fatalf("expected literal passthrough, got %q", out)
	}

	if _, err := ExecuteCommand(context.Background(), "pwd"); err != nil {
		t.Fatalf("pwd failed: %v", err)
	}
}

func TestExecuteCommand_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := ExecuteCommand(ctx, "pwd"); err == nil {
		t.Fatal("expected cancelled context to abort the command")
	}
}

func TestParseArgv(t *testing.T) {
	argv, err := parseArgv(`git log --oneline -n 5`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"git", "log", "--oneline", "-n", "5"}
	if len(argv) != len(want) {
		t.Fatalf("expected %v, got %v", want, argv)
	}
	for i := range want {
		if argv[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, argv)
		}
	}

	if _, err := parseArgv(`echo "unterminated`); err == nil {
		t.Fatal("expected unterminated quote to error")
	}
	if _, err := parseArgv(`echo 'unterminated`); err == nil {
		t.Fatal("expected unterminated quote to error")
	}
}

// TestSecurity_SymlinkEscapeBlocked covers the sandbox hole where a symlink
// inside the workspace pointed outside it and was followed without checking.
func TestSecurity_SymlinkEscapeBlocked(t *testing.T) {
	workspace := t.TempDir()
	outside := t.TempDir()

	secretPath := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("TOP SECRET"), 0o600); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	originalRoot := WorkspaceRoot
	WorkspaceRoot = workspace
	t.Cleanup(func() { WorkspaceRoot = originalRoot })

	// A symlink to a file outside the workspace.
	if err := os.Symlink(secretPath, filepath.Join(workspace, "leak.txt")); err != nil {
		t.Skipf("symlinks unavailable on this platform: %v", err)
	}
	// A symlink to a directory outside the workspace.
	if err := os.Symlink(outside, filepath.Join(workspace, "escape")); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	if out, err := ReadFile("leak.txt"); err == nil {
		t.Fatalf("expected symlinked file read to be blocked, got: %q", out)
	}
	if out, err := ReadFile("escape/secret.txt"); err == nil {
		t.Fatalf("expected read through symlinked directory to be blocked, got: %q", out)
	}
	if _, err := ListDir("escape"); err == nil {
		t.Fatal("expected listing a symlinked directory outside the workspace to be blocked")
	}

	// Writing through a symlinked directory must not create files outside.
	if _, err := WriteFile("escape/planted.txt", "x"); err == nil {
		t.Fatal("expected write through symlinked directory to be blocked")
	}
	if _, err := os.Stat(filepath.Join(outside, "planted.txt")); err == nil {
		t.Fatal("a file was created outside the workspace")
	}

	// Ordinary in-workspace access still works.
	if _, err := WriteFile("nested/ok.txt", "fine"); err != nil {
		t.Fatalf("expected in-workspace write to succeed: %v", err)
	}
	if content, err := ReadFile("nested/ok.txt"); err != nil || content != "fine" {
		t.Fatalf("expected in-workspace read to succeed, got %q / %v", content, err)
	}
}

func TestSecurity_SensitivePathsBlocked(t *testing.T) {
	workspace := t.TempDir()
	originalRoot := WorkspaceRoot
	WorkspaceRoot = workspace
	t.Cleanup(func() { WorkspaceRoot = originalRoot })

	for _, path := range []string{
		".env",
		".env.local",
		"config/.env.production",
		".ssh/id_rsa",
		"nested/.aws/credentials",
		"certs/server.pem",
		"certs/server.key",
		".netrc",
	} {
		if _, err := ReadFile(path); err == nil {
			t.Fatalf("expected %q to be blocked", path)
		}
		if _, err := WriteFile(path, "x"); err == nil {
			t.Fatalf("expected write to %q to be blocked", path)
		}
	}
}
