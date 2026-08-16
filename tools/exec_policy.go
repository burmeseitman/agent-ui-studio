package tools

import (
	"fmt"
	"strings"
)

// commandRule describes what a single allowlisted binary is permitted to do.
//
// The policy is deliberately narrow: commands run through exec without a shell,
// so anything that would require shell interpretation (pipes, substitution,
// redirection) is rejected before it reaches this table.
type commandRule struct {
	// Subcommands, when non-empty, restricts argv[1] to this set. A command
	// with subcommand restrictions cannot be invoked bare.
	Subcommands map[string]struct{}
	// DeniedArgs are rejected anywhere in argv. Matching is exact or against
	// the portion preceding '=' so that "--flag=value" forms are also caught.
	DeniedArgs []string
}

func argSet(names ...string) map[string]struct{} {
	m := make(map[string]struct{}, len(names))
	for _, n := range names {
		m[n] = struct{}{}
	}
	return m
}

// deniedEverywhere lists arguments that turn an otherwise inert command into an
// arbitrary-code executor, regardless of which binary is being run.
var deniedEverywhere = []string{
	"-exec", "--exec", "-execdir", "-ok", "-okdir",
	"-toolexec", "--toolexec",
	"-delete", "-fprintf", "-fprint", "-fls",
}

// allowedCommands is the complete set of binaries execute_command may invoke.
//
// Interpreters and build drivers that trivially execute caller-supplied code
// (node, python, make, docker, cargo, rustc, kubectl, "npm run", "go run",
// "go test") are intentionally absent: there is no way to allow them without
// also allowing arbitrary execution. Users who need those should run them
// themselves.
var allowedCommands = map[string]commandRule{
	// Inert inspection utilities.
	"ls":     {},
	"pwd":    {},
	"echo":   {},
	"date":   {},
	"whoami": {},
	"cat":    {},
	"head":   {},
	"tail":   {},
	"wc":     {},
	"grep":   {},
	"file":   {},
	"stat":   {},

	// find can execute via -exec/-execdir and destroy via -delete.
	"find": {
		DeniedArgs: []string{"-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprintf", "-fprint", "-fls"},
	},

	// git: read-only porcelain only. -c/--exec-path/--upload-pack all lead to
	// running attacker-chosen binaries (e.g. core.pager, core.sshCommand).
	"git": {
		Subcommands: argSet(
			"status", "log", "diff", "show", "branch", "remote", "tag",
			"describe", "blame", "rev-parse", "ls-files", "shortlog",
			"ls-tree", "cat-file", "count-objects", "version",
		),
		DeniedArgs: []string{
			"-c", "--exec-path", "--upload-pack", "--receive-pack",
			"--upload-archive", "-P", "--paginate",
		},
	},

	// go: analysis and compilation only. -toolexec/-exec run binaries.
	"go": {
		Subcommands: argSet("version", "env", "list", "vet", "fmt", "doc", "mod", "build"),
		DeniedArgs:  []string{"-toolexec", "-exec", "-overlay", "-pkgdir"},
	},

	// npm: metadata queries only. install/ci/run/exec all execute lifecycle scripts.
	"npm": {
		Subcommands: argSet("ls", "list", "view", "outdated", "why", "--version", "-v", "root", "prefix"),
	},
}

// checkCommandPolicy validates a parsed argv against the allowlist.
func checkCommandPolicy(argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("command cannot be empty")
	}

	base := argv[0]
	if strings.ContainsAny(base, "/\\") {
		return fmt.Errorf("security violation: command must be a bare name, not a path (%q)", base)
	}

	rule, ok := allowedCommands[base]
	if !ok {
		return fmt.Errorf("security violation: command %q is not in the allowlist", base)
	}

	for _, arg := range argv[1:] {
		flag := arg
		if idx := strings.Index(arg, "="); idx > 0 {
			flag = arg[:idx]
		}
		for _, denied := range deniedEverywhere {
			if flag == denied {
				return fmt.Errorf("security violation: argument %q is not permitted", arg)
			}
		}
		for _, denied := range rule.DeniedArgs {
			if flag == denied {
				return fmt.Errorf("security violation: argument %q is not permitted for %q", arg, base)
			}
		}
	}

	if len(rule.Subcommands) > 0 {
		if len(argv) < 2 {
			return fmt.Errorf("security violation: %q requires an allowlisted subcommand", base)
		}
		sub := argv[1]
		if _, ok := rule.Subcommands[sub]; !ok {
			return fmt.Errorf("security violation: %q subcommand %q is not in the allowlist", base, sub)
		}
	}

	return nil
}

// AllowedCommandNames returns the sorted set of invocable binaries, for docs
// and for the tool description handed to the model.
func AllowedCommandNames() []string {
	names := make([]string, 0, len(allowedCommands))
	for name := range allowedCommands {
		names = append(names, name)
	}
	// Insertion sort keeps this dependency-free and the list is tiny.
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
	return names
}
