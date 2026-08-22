package tools

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The allowlist decides which programs may run; before this guard existed it
// said nothing about what they could touch, so `cat /etc/passwd` walked straight
// past the file sandbox that read_file enforces.
func TestSecurity_CommandsCannotReadOutsideTheWorkspace(t *testing.T) {
	withWorkspace(t)

	cases := []string{
		"cat /etc/passwd",
		"head -2 /etc/hosts",
		"tail /var/log/system.log",
		"ls /Users",
		"grep -r root /etc/passwd",
		"find /etc -type f",
		"wc -l /etc/passwd",
		"file /bin/sh",
		"stat /etc/passwd",
		// Flag-attached paths must be caught too.
		"head --file=/etc/hosts",
		"grep --include=/etc/passwd x .",
		// A literal tilde is not expanded without a shell, but must not pass.
		"cat ~/.ssh/id_rsa",
	}

	for _, command := range cases {
		t.Run(command, func(t *testing.T) {
			out, err := ExecuteCommand(context.Background(), command)
			if err == nil {
				t.Fatalf("expected %q to be refused, got output: %q", command, out)
			}
			if !strings.Contains(err.Error(), "outside the workspace") {
				t.Fatalf("expected a workspace error for %q, got: %v", command, err)
			}
		})
	}
}

func TestSecurity_InWorkspaceCommandsStillWork(t *testing.T) {
	dir := withWorkspace(t)
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "a.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	var commands []string
	if runtime.GOOS == "windows" {
		commands = []string{"git status", "whoami", "go version"}
	} else {
		commands = []string{
			"pwd",
			"ls .",
			"ls src",
			"cat src/a.txt",
			"find . -type f",
			"grep hello src/a.txt",
			"echo plain-argument",
			"wc -l src/a.txt",
		}
	}

	for _, command := range commands {
		if _, err := ExecuteCommand(context.Background(), command); err != nil {
			t.Fatalf("expected %q to be allowed inside the workspace: %v", command, err)
		}
	}
}

func TestSecurity_CommandsCannotReachCredentialsInsideTheWorkspace(t *testing.T) {
	dir := withWorkspace(t)
	if err := os.MkdirAll(filepath.Join(dir, ".ssh"), 0o700); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".ssh", "id_rsa"), []byte("KEY"), 0o600); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("SECRET=1"), 0o600); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	// The same denylist that protects read_file must protect commands.
	for _, command := range []string{"cat .ssh/id_rsa", "cat .env", "find .ssh -type f"} {
		if out, err := ExecuteCommand(context.Background(), command); err == nil {
			t.Fatalf("expected %q to be refused, got: %q", command, out)
		}
	}
}

func TestSecurity_WorkspaceRootCannotBeTooBroad(t *testing.T) {
	original := Workspace()
	t.Cleanup(func() { _, _ = SetWorkspace(original) })

	// A root of "/" would make every containment check a no-op.
	for _, root := range []string{"/", "/etc", "/usr", "/var", "/System"} {
		if _, err := SetWorkspace(root); err == nil {
			t.Fatalf("expected %q to be refused as a workspace root", root)
		}
	}
	if Workspace() != original {
		t.Fatal("a refused root must not change the workspace")
	}

	// An ordinary project directory is fine.
	if _, err := SetWorkspace(t.TempDir()); err != nil {
		t.Fatalf("expected a normal directory to be accepted: %v", err)
	}
}

func TestSecurity_ProjectExecutionDoesNotUnlockExfiltration(t *testing.T) {
	withWorkspace(t)
	SetProjectExecution(true)
	t.Cleanup(func() { SetProjectExecution(false) })

	// curl has no build purpose and is a direct route for moving data off the
	// machine, so it stays out of the project command set.
	if _, err := ExecuteCommand(context.Background(), "curl https://example.com"); err == nil {
		t.Fatal("expected curl to remain blocked with project execution enabled")
	}

	// Build commands still cannot reach outside the workspace.
	if _, err := ExecuteCommand(context.Background(), "node /etc/passwd"); err == nil {
		t.Fatal("expected a path outside the workspace to be refused even for build commands")
	}
}
