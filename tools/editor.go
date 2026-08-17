package tools

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Directories that are never worth walking or searching: they are large,
// generated, and drown the real source in noise.
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true,
	"target": true, "vendor": true, ".next": true, ".nuxt": true,
	"__pycache__": true, ".venv": true, "venv": true, ".cache": true,
	"coverage": true, ".idea": true, ".gradle": true, "Pods": true,
}

const (
	maxTreeEntries   = 400
	maxSearchResults = 100
	maxSearchFileMB  = 2
)

// EditFile replaces an exact string in a file.
//
// This exists because whole-file rewrites are how models destroy code: asked to
// add one line, a model must reproduce the entire file from memory and often
// does not. Anchoring on an exact substring keeps the rest of the file
// byte-identical no matter what the model would have regenerated.
func EditFile(path, oldString, newString string, replaceAll bool) (string, error) {
	if oldString == "" {
		return "", fmt.Errorf("old_string cannot be empty; use write_file to create a file")
	}
	if oldString == newString {
		return "", fmt.Errorf("old_string and new_string are identical, nothing to change")
	}

	safePath, err := sanitizeWorkspacePath(path)
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(safePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}
	content := string(data)

	count := strings.Count(content, oldString)
	if count == 0 {
		return "", fmt.Errorf(
			"old_string was not found in %s. Read the file first and copy the exact text, including whitespace",
			filepath.Base(safePath))
	}
	if count > 1 && !replaceAll {
		return "", fmt.Errorf(
			"old_string appears %d times in %s. Include more surrounding context to make it unique, or set replace_all to true",
			count, filepath.Base(safePath))
	}

	var updated string
	if replaceAll {
		updated = strings.ReplaceAll(content, oldString, newString)
	} else {
		updated = strings.Replace(content, oldString, newString, 1)
	}

	info, err := os.Stat(safePath)
	mode := fs.FileMode(0o644)
	if err == nil {
		mode = info.Mode().Perm()
	}
	if err := os.WriteFile(safePath, []byte(updated), mode); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	replaced := 1
	if replaceAll {
		replaced = count
	}
	return fmt.Sprintf("Replaced %d occurrence(s) in %s", replaced, filepath.Base(safePath)), nil
}

// DeleteFile removes a file, or an empty directory, inside the workspace.
func DeleteFile(path string) (string, error) {
	safePath, err := sanitizeWorkspacePath(path)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(safePath)
	if err != nil {
		return "", fmt.Errorf("failed to stat path: %w", err)
	}

	if info.IsDir() {
		entries, err := os.ReadDir(safePath)
		if err != nil {
			return "", fmt.Errorf("failed to read directory: %w", err)
		}
		// Recursive deletion is never worth the blast radius from a tool call.
		if len(entries) > 0 {
			return "", fmt.Errorf("directory %s is not empty; delete its contents individually",
				filepath.Base(safePath))
		}
	}

	if err := os.Remove(safePath); err != nil {
		return "", fmt.Errorf("failed to delete: %w", err)
	}
	return fmt.Sprintf("Deleted %s", filepath.Base(safePath)), nil
}

// MoveFile renames or moves a path, with both ends inside the workspace.
func MoveFile(from, to string) (string, error) {
	safeFrom, err := sanitizeWorkspacePath(from)
	if err != nil {
		return "", err
	}
	safeTo, err := sanitizeWorkspacePath(to)
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(safeFrom); err != nil {
		return "", fmt.Errorf("source does not exist: %w", err)
	}
	if _, err := os.Stat(safeTo); err == nil {
		return "", fmt.Errorf("destination %s already exists", filepath.Base(safeTo))
	}

	if err := os.MkdirAll(filepath.Dir(safeTo), 0o755); err != nil {
		return "", fmt.Errorf("failed to create destination directory: %w", err)
	}
	if err := os.Rename(safeFrom, safeTo); err != nil {
		return "", fmt.Errorf("failed to move: %w", err)
	}
	return fmt.Sprintf("Moved %s to %s", filepath.Base(safeFrom), filepath.Base(safeTo)), nil
}

// ListTree renders a recursive view of the workspace so the model can see the
// project's shape in one call rather than walking it a directory at a time.
func ListTree(path string, maxDepth int) (string, error) {
	if maxDepth <= 0 {
		maxDepth = 3
	}
	if maxDepth > 8 {
		maxDepth = 8
	}
	if path == "" {
		path = "."
	}

	root, err := sanitizeWorkspacePath(path)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	count := 0
	truncated := false

	var walk func(dir string, depth int, prefix string) error
	walk = func(dir string, depth int, prefix string) error {
		if depth > maxDepth || truncated {
			return nil
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil // unreadable subtrees are skipped, not fatal
		}

		sort.Slice(entries, func(i, j int) bool {
			if entries[i].IsDir() != entries[j].IsDir() {
				return entries[i].IsDir()
			}
			return entries[i].Name() < entries[j].Name()
		})

		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") && name != ".github" {
				continue
			}
			if entry.IsDir() && skipDirs[name] {
				sb.WriteString(fmt.Sprintf("%s%s/ (skipped)\n", prefix, name))
				continue
			}
			if count >= maxTreeEntries {
				truncated = true
				return nil
			}
			count++

			if entry.IsDir() {
				sb.WriteString(fmt.Sprintf("%s%s/\n", prefix, name))
				if err := walk(filepath.Join(dir, name), depth+1, prefix+"  "); err != nil {
					return err
				}
			} else {
				sb.WriteString(fmt.Sprintf("%s%s\n", prefix, name))
			}
		}
		return nil
	}

	if err := walk(root, 1, ""); err != nil {
		return "", err
	}
	if truncated {
		sb.WriteString(fmt.Sprintf("... [truncated at %d entries; list a subdirectory for more]\n", maxTreeEntries))
	}
	if count == 0 {
		return fmt.Sprintf("%s is empty.", filepath.Base(root)), nil
	}
	return fmt.Sprintf("%s/\n%s", filepath.Base(root), sb.String()), nil
}

// SearchFiles finds a literal substring across the workspace and reports
// file:line matches, so the model can locate code without shelling out.
func SearchFiles(query, pathFilter string) (string, error) {
	if strings.TrimSpace(query) == "" {
		return "", fmt.Errorf("query cannot be empty")
	}

	root, err := sanitizeWorkspacePath(".")
	if err != nil {
		return "", err
	}

	var matches []string
	truncated := false

	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || truncated {
			return nil //nolint:nilerr // unreadable entries are skipped
		}
		name := d.Name()
		if d.IsDir() {
			if p != root && (skipDirs[name] || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if pathFilter != "" && !strings.Contains(p, pathFilter) {
			return nil
		}

		info, err := d.Info()
		if err != nil || info.Size() > maxSearchFileMB*1024*1024 {
			return nil
		}

		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		// Skip binaries rather than dumping control characters into the context.
		if strings.IndexByte(string(data[:min(len(data), 1024)]), 0) >= 0 {
			return nil
		}

		rel, _ := filepath.Rel(root, p)
		for i, line := range strings.Split(string(data), "\n") {
			if strings.Contains(line, query) {
				trimmed := strings.TrimSpace(line)
				matches = append(matches, fmt.Sprintf("%s:%d: %s", rel, i+1, truncateString(trimmed, 160)))
				if len(matches) >= maxSearchResults {
					truncated = true
					return filepath.SkipAll
				}
			}
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("search failed: %w", err)
	}

	if len(matches) == 0 {
		return fmt.Sprintf("No matches for %q.", query), nil
	}

	out := strings.Join(matches, "\n")
	if truncated {
		out += fmt.Sprintf("\n... [stopped at %d matches; narrow the query or set path_filter]", maxSearchResults)
	}
	return out, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
