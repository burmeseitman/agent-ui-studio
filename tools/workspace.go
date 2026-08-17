package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// The workspace root is read by every file tool on request-handling goroutines
// and can be changed at runtime by the user, so it is guarded rather than left
// as a bare package variable.
var (
	workspaceMu   sync.RWMutex
	workspaceRoot string
)

func init() {
	if wd, err := os.Getwd(); err == nil {
		workspaceRoot = wd
	}
}

// Workspace returns the directory file tools are confined to.
func Workspace() string {
	workspaceMu.RLock()
	defer workspaceMu.RUnlock()
	if workspaceRoot != "" {
		return workspaceRoot
	}
	// Falling back to the process directory keeps tools usable rather than
	// failing every call if the root was never established.
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return wd
}

// SetWorkspace points the file tools at dir, which must be an existing
// directory. The resolved absolute path is returned.
func SetWorkspace(dir string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("workspace path cannot be empty")
	}

	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("invalid workspace path: %w", err)
	}

	if err := ensureDirExists(abs); err != nil {
		return "", err
	}
	if err := assertSafeRoot(abs); err != nil {
		return "", err
	}

	workspaceMu.Lock()
	workspaceRoot = abs
	workspaceMu.Unlock()

	return abs, nil
}
