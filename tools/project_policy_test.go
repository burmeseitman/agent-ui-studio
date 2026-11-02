package tools

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// yarn and pnpm were listed in projectSubcommands but in neither command
// table, so the widening step had no entry to widen and argv[0] was rejected
// before it was ever reached: the configuration read as support for both while
// every invocation failed.
func TestProjectExecution_YarnAndPnpmAreInvocable(t *testing.T) {
	SetProjectExecution(true)
	t.Cleanup(func() { SetProjectExecution(false) })

	for _, command := range []string{
		"yarn install", "yarn add left-pad", "yarn build", "yarn test",
		"pnpm install", "pnpm run build", "pnpm dev",
	} {
		t.Run(command, func(t *testing.T) {
			argv, err := parseArgv(command)
			if err != nil {
				t.Fatalf("failed to parse %q: %v", command, err)
			}
			if err := checkCommandPolicy(argv); err != nil {
				t.Fatalf("expected %q to be permitted with project execution on, got: %v", command, err)
			}
		})
	}
}

// Being invocable must not mean unrestricted: the subcommand set is the whole
// point of listing them rather than leaving them wide open like node.
func TestProjectExecution_YarnSubcommandsStillRestricted(t *testing.T) {
	SetProjectExecution(true)
	t.Cleanup(func() { SetProjectExecution(false) })

	for _, command := range []string{"yarn publish", "pnpm publish", "yarn", "pnpm config set x y"} {
		t.Run(command, func(t *testing.T) {
			argv, err := parseArgv(command)
			if err != nil {
				t.Fatalf("failed to parse %q: %v", command, err)
			}
			if err := checkCommandPolicy(argv); err == nil {
				t.Fatalf("expected %q to be refused", command)
			}
		})
	}
}

func TestProjectExecution_YarnRefusedWhenDisabled(t *testing.T) {
	SetProjectExecution(false)

	argv, err := parseArgv("yarn install")
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	err = checkCommandPolicy(argv)
	if err == nil {
		t.Fatal("expected yarn install to be refused with project execution off")
	}
	// The message has to point at the setting, or the user has no way to know
	// the command is available at all.
	if !strings.Contains(err.Error(), "project execution") {
		t.Fatalf("expected the error to mention project execution, got: %v", err)
	}
}

// The reported allowlist is what the model is told it may run. Reporting the
// read-only set while project execution is on tells it npm install and node are
// forbidden when they are available, and it will not attempt them.
func TestAllowedCommandNames_TracksProjectExecution(t *testing.T) {
	SetProjectExecution(false)
	readOnly := AllowedCommandNames()
	for _, name := range readOnly {
		if name == "node" || name == "yarn" {
			t.Fatalf("project command %q reported while project execution is off", name)
		}
	}

	SetProjectExecution(true)
	t.Cleanup(func() { SetProjectExecution(false) })
	widened := AllowedCommandNames()

	for _, want := range []string{"node", "yarn", "pnpm", "python3", "cargo"} {
		if !contains(widened, want) {
			t.Fatalf("expected %q in the allowlist with project execution on, got %v", want, widened)
		}
	}
	// The read-only set must still be there; this widens, it does not replace.
	for _, want := range readOnly {
		if !contains(widened, want) {
			t.Fatalf("read-only command %q disappeared when project execution was enabled", want)
		}
	}
	if !isSorted(widened) {
		t.Fatalf("expected a sorted list, got %v", widened)
	}
	for i := 1; i < len(widened); i++ {
		if widened[i] == widened[i-1] {
			t.Fatalf("duplicate entry %q in %v", widened[i], widened)
		}
	}
}

// The execute_command schema is built once and cached, so a description that
// embedded the allowlist froze whatever the policy was at first call.
func TestExecuteCommandDescription_ReflectsCurrentPolicy(t *testing.T) {
	SetProjectExecution(false)
	if describe := toolDescription(t, "execute_command"); strings.Contains(describe, "node") {
		t.Fatalf("description advertises node while project execution is off: %q", describe)
	}

	SetProjectExecution(true)
	t.Cleanup(func() { SetProjectExecution(false) })
	describe := toolDescription(t, "execute_command")
	if !strings.Contains(describe, "node") || !strings.Contains(describe, "yarn") {
		t.Fatalf("description does not advertise project commands after they were enabled: %q", describe)
	}
}

func toolDescription(t *testing.T, name string) string {
	t.Helper()
	for _, def := range AllTools() {
		if def.Function.Name == name {
			return def.Function.Description
		}
	}
	t.Fatalf("tool %q not found in the registry", name)
	return ""
}

// On macOS /etc and /var are symlinks into /private, so blocking the literal
// path left /private/etc as an unguarded alias for the same directory.
func TestAssertSafeRoot_RejectsSymlinkAliases(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the /private aliases are macOS-specific")
	}

	for _, path := range []string{"/private/etc", "/private/var", "/private/var/root"} {
		t.Run(path, func(t *testing.T) {
			if _, err := filepath.EvalSymlinks(path); err != nil {
				t.Skipf("%s is not present on this machine", path)
			}
			if err := assertSafeRoot(path); err == nil {
				t.Fatalf("expected %s to be refused as a workspace root", path)
			}
		})
	}
}

// Blocking by prefix instead of by resolved identity would have caught the
// aliases and also every per-user temporary directory, which live under
// /private/var on macOS and are where the tests themselves run.
func TestAssertSafeRoot_AllowsDirectoriesBelowAForbiddenRoot(t *testing.T) {
	original := Workspace()
	t.Cleanup(func() { _, _ = SetWorkspace(original) })

	dir := t.TempDir()
	if err := assertSafeRoot(dir); err != nil {
		t.Fatalf("expected the temporary directory %s to be usable, got: %v", dir, err)
	}
	if _, err := SetWorkspace(dir); err != nil {
		t.Fatalf("expected SetWorkspace to accept %s, got: %v", dir, err)
	}
}

func contains(haystack []string, needle string) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
}

func isSorted(names []string) bool {
	for i := 1; i < len(names); i++ {
		if names[i] < names[i-1] {
			return false
		}
	}
	return true
}
