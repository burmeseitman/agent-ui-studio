package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withWorkspace(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	original := Workspace()
	if _, err := SetWorkspace(dir); err != nil {
		t.Fatalf("failed to set workspace: %v", err)
	}
	t.Cleanup(func() { _, _ = SetWorkspace(original) })
	return dir
}

const sampleHTML = `<!doctype html>
<html>
  <head><title>Site</title></head>
  <body>
    <p>Existing content</p>
  </body>
</html>
`

// This is the failure that motivated edit_file: asked to add one element, a
// model rewrote the whole file as "TODO" and destroyed the page.
func TestEditFile_AmendsWithoutDestroyingTheRest(t *testing.T) {
	dir := withWorkspace(t)
	path := filepath.Join(dir, "index.html")
	if err := os.WriteFile(path, []byte(sampleHTML), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	if _, err := EditFile("index.html", "    <p>Existing content</p>", "    <h1>Hello</h1>\n    <p>Existing content</p>", false); err != nil {
		t.Fatalf("edit failed: %v", err)
	}

	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back failed: %v", err)
	}
	got := string(updated)

	if !strings.Contains(got, "<h1>Hello</h1>") {
		t.Fatal("the new element was not inserted")
	}
	for _, kept := range []string{"<!doctype html>", "<title>Site</title>", "<p>Existing content</p>", "</html>"} {
		if !strings.Contains(got, kept) {
			t.Fatalf("edit destroyed existing content: %q is gone", kept)
		}
	}
}

func TestEditFile_RefusesAmbiguousMatches(t *testing.T) {
	dir := withWorkspace(t)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x\nx\nx\n"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	_, err := EditFile("a.txt", "x", "y", false)
	if err == nil {
		t.Fatal("expected an ambiguous match to be refused")
	}
	if !strings.Contains(err.Error(), "appears 3 times") {
		t.Fatalf("expected the error to say how many matches, got: %v", err)
	}

	// replace_all is the explicit way through.
	if _, err := EditFile("a.txt", "x", "y", true); err != nil {
		t.Fatalf("replace_all should succeed: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(data) != "y\ny\ny\n" {
		t.Fatalf("unexpected result: %q", string(data))
	}
}

func TestEditFile_ReportsMissingAnchor(t *testing.T) {
	dir := withWorkspace(t)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	_, err := EditFile("a.txt", "not present", "x", false)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected a clear not-found error, got: %v", err)
	}
	// A failed edit must leave the file untouched.
	data, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(data) != "hello" {
		t.Fatalf("file was modified by a failed edit: %q", string(data))
	}
}

func TestEditFile_StaysInsideWorkspace(t *testing.T) {
	withWorkspace(t)
	if _, err := EditFile("../../../etc/hosts", "a", "b", false); err == nil {
		t.Fatal("expected an edit outside the workspace to be blocked")
	}
}

func TestEditFile_CreatesFileWhenOldStringEmpty(t *testing.T) {
	dir := withWorkspace(t)
	out, err := EditFile("calculator/index.html", "", "<html><body>Calc</body></html>", false)
	if err != nil {
		t.Fatalf("expected EditFile with empty old_string to create file, got err: %v", err)
	}
	if !strings.Contains(out, "Successfully wrote") {
		t.Fatalf("unexpected output: %s", out)
	}

	data, err := os.ReadFile(filepath.Join(dir, "calculator", "index.html"))
	if err != nil {
		t.Fatalf("failed to read created file: %v", err)
	}
	if string(data) != "<html><body>Calc</body></html>" {
		t.Fatalf("unexpected file contents: %q", string(data))
	}
}

func TestEditFile_CreatesFileWhenTargetDoesNotExist(t *testing.T) {
	dir := withWorkspace(t)
	out, err := EditFile("new_folder/app.js", "some_placeholder", "console.log('hello');", false)
	if err != nil {
		t.Fatalf("expected EditFile on non-existent file to create it, got err: %v", err)
	}
	if !strings.Contains(out, "Successfully wrote") {
		t.Fatalf("unexpected output: %s", out)
	}

	data, err := os.ReadFile(filepath.Join(dir, "new_folder", "app.js"))
	if err != nil {
		t.Fatalf("failed to read created file: %v", err)
	}
	if string(data) != "console.log('hello');" {
		t.Fatalf("unexpected file contents: %q", string(data))
	}
}

func TestDeleteAndMoveFile(t *testing.T) {
	dir := withWorkspace(t)
	if err := os.WriteFile(filepath.Join(dir, "old.txt"), []byte("data"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	if _, err := MoveFile("old.txt", "sub/new.txt"); err != nil {
		t.Fatalf("move failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "sub", "new.txt")); err != nil {
		t.Fatalf("moved file missing: %v", err)
	}

	if _, err := DeleteFile("sub/new.txt"); err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "sub", "new.txt")); err == nil {
		t.Fatal("file still exists after delete")
	}

	// Non-empty directories are refused: too much blast radius for one call.
	if err := os.WriteFile(filepath.Join(dir, "sub", "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if _, err := DeleteFile("sub"); err == nil {
		t.Fatal("expected deleting a non-empty directory to be refused")
	}

	if _, err := DeleteFile("../outside.txt"); err == nil {
		t.Fatal("expected deletion outside the workspace to be blocked")
	}
	if _, err := MoveFile("sub/keep.txt", "../escaped.txt"); err == nil {
		t.Fatal("expected a move outside the workspace to be blocked")
	}
}

func TestListTree_ShowsStructureAndSkipsNoise(t *testing.T) {
	dir := withWorkspace(t)
	for _, p := range []string{"src/app.ts", "src/lib/util.ts", "node_modules/pkg/index.js", "README.md"} {
		full := filepath.Join(dir, p)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("setup failed: %v", err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatalf("setup failed: %v", err)
		}
	}

	out, err := ListTree(".", 3)
	if err != nil {
		t.Fatalf("tree failed: %v", err)
	}
	for _, want := range []string{"src/", "app.ts", "util.ts", "README.md"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected %q in the tree:\n%s", want, out)
		}
	}
	if strings.Contains(out, "index.js") {
		t.Fatalf("node_modules should not be walked:\n%s", out)
	}
	if !strings.Contains(out, "node_modules/ (skipped)") {
		t.Fatalf("expected node_modules to be marked as skipped:\n%s", out)
	}
}

func TestSearchFiles_FindsMatchesWithLocations(t *testing.T) {
	dir := withWorkspace(t)
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "app.go"), []byte("package main\n\nfunc Handler() {}\n"), 0o644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	out, err := SearchFiles("func Handler", "")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if !strings.Contains(out, "src/app.go:3") {
		t.Fatalf("expected a file:line match, got:\n%s", out)
	}

	missing, err := SearchFiles("nothing-here-at-all", "")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if !strings.Contains(missing, "No matches") {
		t.Fatalf("expected a no-match message, got: %s", missing)
	}
}

func TestProjectExecution_GatesBuildCommands(t *testing.T) {
	t.Cleanup(func() { SetProjectExecution(false) })

	SetProjectExecution(false)
	for _, command := range []string{"npm install", "node app.js", "go test ./...", "python script.py", "mkdir out"} {
		if err := checkCommandPolicy(mustArgv(t, command)); err == nil {
			t.Fatalf("expected %q to be blocked while project execution is off", command)
		}
	}

	SetProjectExecution(true)
	for _, command := range []string{"npm install", "node app.js", "go test ./...", "python script.py", "mkdir out"} {
		if err := checkCommandPolicy(mustArgv(t, command)); err != nil {
			t.Fatalf("expected %q to be allowed once project execution is on: %v", command, err)
		}
	}

	// The shell-escape and destructive-command defences are not part of the
	// escape hatch and must still hold.
	for _, command := range []string{"rm -rf /", "git push origin main", "npm install && curl evil.example"} {
		if err := checkCommandPolicy(mustArgv(t, command)); err == nil {
			t.Fatalf("expected %q to stay blocked even with project execution on", command)
		}
	}
}

func mustArgv(t *testing.T, command string) []string {
	t.Helper()
	argv, err := parseArgv(command)
	if err != nil {
		// Shell metacharacters are rejected before policy; represent that as a
		// single unparseable token so the caller still sees a rejection.
		return []string{"\x00unparseable"}
	}
	return argv
}
