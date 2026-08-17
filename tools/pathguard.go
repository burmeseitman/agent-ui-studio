package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Workspace roots that would make the sandbox meaningless. Setting the root to
// "/" turns every containment check into a no-op, so these are refused outright.
var forbiddenRoots = map[string]bool{
	"/": true, "/etc": true, "/usr": true, "/bin": true, "/sbin": true,
	"/var": true, "/private": true, "/System": true, "/Library": true,
	"/Applications": true, "/opt": true, "/dev": true, "/proc": true,
	"/root": true, "/boot": true,
	"C:\\": true, "C:\\Windows": true, "C:\\Program Files": true,
}

// assertSafeRoot rejects directories that are too broad to sandbox.
func assertSafeRoot(abs string) error {
	clean := filepath.Clean(abs)
	if forbiddenRoots[clean] {
		return fmt.Errorf(
			"%s is too broad to use as a workspace; choose a project folder instead", clean)
	}
	if clean == string(filepath.Separator) {
		return fmt.Errorf("the filesystem root is too broad to use as a workspace")
	}
	return nil
}

// looksLikePath reports whether a command argument is plausibly a filesystem
// path, and so worth checking against the workspace boundary.
func looksLikePath(arg string) bool {
	if arg == "" {
		return false
	}
	return strings.HasPrefix(arg, "/") ||
		strings.HasPrefix(arg, "~") ||
		strings.HasPrefix(arg, ".") ||
		strings.Contains(arg, "/") ||
		strings.Contains(arg, "\\")
}

// pathOperands extracts the path-like parts of a single argument, including the
// value half of `--flag=/some/path`.
func pathOperands(arg string) []string {
	if strings.HasPrefix(arg, "-") {
		if idx := strings.Index(arg, "="); idx > 0 {
			value := arg[idx+1:]
			if looksLikePath(value) {
				return []string{value}
			}
		}
		// A bare flag such as -name or -type is not a path.
		return nil
	}
	if looksLikePath(arg) {
		return []string{arg}
	}
	return nil
}

// checkCommandPaths confines a command's file arguments to the workspace.
//
// Without this the sandbox is trivially bypassed: read_file refuses
// /etc/passwd, but `cat /etc/passwd` reads it, and `find ~/.ssh` enumerates
// private keys. The allowlist controls which programs may run; this controls
// what they may touch.
func checkCommandPaths(argv []string) error {
	for _, arg := range argv[1:] {
		for _, operand := range pathOperands(arg) {
			// A literal ~ is not expanded (no shell), but treat it as a home
			// reference anyway rather than letting it through as a filename.
			if strings.HasPrefix(operand, "~") {
				return fmt.Errorf(
					"access denied: %q refers outside the workspace", operand)
			}
			if _, err := sanitizeWorkspacePath(operand); err != nil {
				return fmt.Errorf("access denied: %q is outside the workspace", operand)
			}
		}
	}
	return nil
}

// WorkspaceContains reports whether path resolves inside the workspace. Used by
// callers that want to check without producing an error message.
func WorkspaceContains(path string) bool {
	_, err := sanitizeWorkspacePath(path)
	return err == nil
}

// ensureDirExists is a small helper for validating candidate workspace roots.
func ensureDirExists(abs string) error {
	info, err := os.Stat(abs)
	if err != nil {
		return fmt.Errorf("workspace path is not accessible: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("workspace path is not a directory: %s", abs)
	}
	return nil
}
