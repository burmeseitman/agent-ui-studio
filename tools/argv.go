package tools

import (
	"fmt"
	"strings"
)

// shellMetacharacters are the constructs that only have meaning when a string
// is handed to a shell. Because commands are executed via exec without a shell,
// their presence means the caller expected shell semantics we deliberately do
// not provide — so they are rejected rather than silently passed through as
// literal text.
const shellMetacharacters = "|&;<>()$`\n\r{}!"

// parseArgv splits a command string into an argv slice using POSIX-ish quoting
// rules, and rejects any unquoted shell metacharacter.
//
// Quoted text is taken literally, so `grep "a|b" file.txt` is accepted while
// `grep a | b` is not.
func parseArgv(command string) ([]string, error) {
	var (
		argv    []string
		current strings.Builder
		started bool
	)

	runes := []rune(command)
	for i := 0; i < len(runes); i++ {
		c := runes[i]

		switch c {
		case ' ', '\t':
			if started {
				argv = append(argv, current.String())
				current.Reset()
				started = false
			}

		case '\'':
			started = true
			closed := false
			for i++; i < len(runes); i++ {
				if runes[i] == '\'' {
					closed = true
					break
				}
				current.WriteRune(runes[i])
			}
			if !closed {
				return nil, fmt.Errorf("unterminated single quote")
			}

		case '"':
			started = true
			closed := false
			for i++; i < len(runes); i++ {
				if runes[i] == '"' {
					closed = true
					break
				}
				// Inside double quotes a backslash escapes the next character.
				if runes[i] == '\\' && i+1 < len(runes) {
					i++
				}
				current.WriteRune(runes[i])
			}
			if !closed {
				return nil, fmt.Errorf("unterminated double quote")
			}

		case '\\':
			if i+1 >= len(runes) {
				return nil, fmt.Errorf("trailing backslash")
			}
			i++
			current.WriteRune(runes[i])
			started = true

		default:
			if strings.ContainsRune(shellMetacharacters, c) {
				return nil, fmt.Errorf(
					"security violation: shell metacharacter %q is not supported; "+
						"commands run without a shell, so pipes, redirection, substitution and "+
						"chaining are unavailable — run one command at a time",
					string(c),
				)
			}
			current.WriteRune(c)
			started = true
		}
	}

	if started {
		argv = append(argv, current.String())
	}

	if len(argv) == 0 {
		return nil, fmt.Errorf("command cannot be empty")
	}

	return argv, nil
}
