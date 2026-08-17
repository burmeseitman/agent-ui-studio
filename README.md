# 🚀 AgentUI Studio

A lightweight, zero-latency developer workspace for managing and interacting with local AI engines (**Ollama**, **LM Studio**, **vLLM**).

Built with **Go (Backend Daemon)** + **React & Tauri (Frontend)**.

---

## 🌟 Key Features

- 🔍 **Zero-Config Auto-Discovery**: Automatically scans local ports (`:11434` for Ollama, `:1234` for LM Studio) and dynamically lists available models.
- ⚡ **Real-Time SSE Token Streaming**: Server-Sent Events streaming with time-to-first-token and engine-reported tokens/sec metrics.
- 🛠️ **Coding Agent Tools**: `list_tree`, `search_files`, `read_file`, `edit_file`, `write_file`, `move_file`, `delete_file` and `execute_command` — real function calling, with every change surfaced for approval as a diff.
- 🎛️ **Dynamic Model Adapter**: Routes chat completions to native Ollama (`/api/chat`) and OpenAI-compatible engines (`/v1/chat/completions`), normalising tool calls and usage across both.
- 💬 **Multiple Conversations**: Named, switchable chat sessions kept in the browser, with the pre-sessions history migrated automatically.
- 🎨 **Considered Interface**: Dark, low-chroma palette with bundled Inter and JetBrains Mono, a native macOS title bar, syntax highlighting and live generation metrics.
- 🖥️ **Native Desktop App**: Tauri build that bundles the daemon inside the app — double-click to run, no terminal.

---

## 🛠️ Architecture

```
AgentUI Studio
├── web/                       # React 19 + Vite + Tailwind CSS + Tauri
│   ├── src/                   # Components, SSE client, dark mode UI
│   └── src-tauri/             # Tauri native desktop wrapper
├── engine/                    # Engine discovery workers (Ollama & LM Studio)
├── adapter/                   # Unified streaming chat + tool-call adapter
├── tools/                     # Tool registry, sandboxed executors, exec policy
├── api/                       # REST API handlers, agent loop, CORS & auth
└── main.go                    # Daemon entry point & graceful shutdown
```

---

## 🚀 Quick Start

### Choosing a model

**The persona picks the model for you.** Switching preset re-selects the best installed model for that kind of work:

| Persona | Prefers |
| --- | --- |
| Developer | A code-tuned model that reports `tools` capability — required, since without tool calling the agent cannot read or edit anything |
| Content Writer | A general instruct model; code-tuned models are heavily discounted for prose |
| Researcher | A general model, favouring long context |
| Custom | Simply the most capable model available |

Ollama reports each model's real capabilities, so tool support is read rather than guessed; engines that expose no metadata (LM Studio, vLLM) fall back to name heuristics. Embedding and completion-only models are never auto-selected. Picking a model by hand overrides the default until you switch persona again.

Agent work needs a **tool-capable** model. Good local starting point:

```bash
ollama pull qwen2.5-coder:7b
```

Base/completion models (`starcoder2`, plain `codellama`, and similar) cannot do tool calling — the daemon detects this, answers without tools, and tells you rather than surfacing a raw error.

Many small models write tool calls as plain text instead of using the native channel. The daemon recovers those automatically, so they still work as agents.

### 1. Start the Backend Daemon
```bash
go run .
```

If you start the daemon with `-api-token`, the web UI will prompt for that token on first load and store it in the browser.

### 2. Start the Frontend Workspace
```bash
cd web && npm install && npm run dev
```

Open `http://localhost:5173`.

For a single-origin setup, build the frontend and let the daemon serve it:

```bash
cd web && npm run build && cd .. && go run . -static-dir web/dist
```

### Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `-port` | `8080` | Listen port (also `PORT`) |
| `-ollama-url` | `http://localhost:11434` | Ollama base URL (also `OLLAMA_URL`) |
| `-lmstudio-url` | `http://localhost:1234` | LM Studio base URL (also `LMSTUDIO_URL`) |
| `-workspace` | current directory | Root directory tools may read and write |
| `-static-dir` | `web/dist` | Built frontend to serve (empty to disable) |
| `-api-token` | none | Bearer token required on all API routes (also `AGENTUI_TOKEN`) |
| `-timeout` | `1500` | Engine discovery probe timeout in ms |
| `-host` | `127.0.0.1` | Interface to bind. Anything other than loopback requires a token |
| `-allowed-origins` | none | Extra browser origins permitted to call the API |
| `-shutdown-on-stdin-close` | off | Exit when stdin reaches EOF. Set by the desktop app so the daemon cannot outlive a force-quit |

---

## 🔐 Security Model

The daemon executes tools on your real machine, so the boundaries are deliberate:

- **Loopback only.** The daemon binds `127.0.0.1`. Binding anywhere else requires `-host` *and* an `-api-token`; without a token it refuses to start, because an exposed daemon is remote code execution for anyone on the network.
- **Only the app's own origins may call the API.** Trusting every `localhost` port meant any dev server you happened to run — including one serving a project you just cloned — could reconfigure the workspace, enable execution and run code. Permitted origins are the daemon's own, the Vite dev server, and the Tauri app; add more with `-allowed-origins`.
- **Commands are confined to the workspace, not just the program list.** The allowlist says which binaries may run; path checking says what they may touch. `cat /etc/passwd`, `find ~/.ssh` and `head --file=/etc/hosts` are all refused, and the credential denylist applies to command arguments exactly as it does to `read_file`.
- **The workspace root cannot be `/`.** Roots such as `/`, `/etc`, `/usr` and `/System` are refused, since they would make every containment check a no-op.

- **Edits are surgical, not rewrites.** `edit_file` replaces an exact snippet and leaves the rest of the file byte-identical. `write_file` (whole-file overwrite) exists only for creating new files — the developer prompt tells the model to prefer `edit_file`, because a model asked to add one line will otherwise reproduce the file from memory and lose things.
- **Building and running is opt-in.** By default `execute_command` allows read-only inspection only. *Settings → Let the agent build & run* unlocks `npm install`, `node`, `python`, `go test` and similar. That is arbitrary code execution by design — a package install script or a test file can do anything — so it is off until you turn it on, enforced by the daemon rather than the UI. The shell-escape, path-sandbox and destructive-command defences all still apply either way.
- **Writes always require approval.** Tool autonomy is a three-way choice in the sidebar:
  - *Ask every time* — nothing runs without a click.
  - *Auto-run reads* (default) — inspection tools (`read_file`, `list_dir`, `fetch_url`, `analyze_readability`, `execute_command`) run unattended; `write_file` waits for you.
  - *Run everything* — full autonomy, for models and prompts you trust.

  The daemon enforces this, not the UI: it executes only what `auto_approve_tools` names, and a turn is judged as a whole — if a model asks for a read and a write together, the entire batch goes to you. A tool the daemon never advertised is never executed, whatever the engine returns.
- **`execute_command` never uses a shell.** Commands are parsed into argv and executed directly, so pipes, redirection, command substitution, chaining and globbing are rejected rather than interpreted. Only an allowlist of read-only binaries can run, and `git`/`go`/`npm` are further restricted to non-executing subcommands. Anything else you run yourself.
- **You choose the folder before you prompt.** The empty chat screen leads with a folder picker, and a slim strip above the composer keeps the active folder visible once you are chatting. Starting in your home directory is called out explicitly, since that is the default and almost never what you mean. The path also goes into the system prompt, so the model resolves relative paths correctly instead of guessing. Changing it is a user action through the UI (a native folder picker in the desktop app) — deliberately *not* a tool, so a model cannot widen its own reach.
- **File tools are sandboxed to the workspace.** Paths are resolved through symlinks *before* the containment check, so a link inside the project cannot reach outside it. Credential files and directories (`.env*`, `.ssh`, `.aws`, `*.pem`, `*.key`, `.netrc`, …) are blocked even within it.
- **Child processes get a minimal environment.** Cloud credentials and API tokens in the daemon's environment are not inherited by model-triggered commands.
- **`fetch_url` is SSRF-hardened.** Loopback, private, link-local and cloud-metadata addresses are refused, redirects are re-validated, and responses are size-capped.
- **CORS is origin-locked** to localhost and Tauri origins; a token, when configured, is required on every API route except `/health`. `GET /health` reports `auth_required` so the UI can prompt for the token instead of failing silently — enter it in the sidebar under *Settings*, and it is kept in that browser only.
- **Writes are previewed as a diff.** A pending `write_file` shows what would actually change against the current file, rather than a JSON blob of the new contents.
- **History is bounded.** The client trims old turns and truncates stale tool output to a character budget before each request, so a few large file reads cannot silently overflow a local model's context.

---

## 🖥️ Desktop App

The desktop build bundles the Go daemon as a Tauri **sidecar**, so there is nothing to start by hand:

```bash
make desktop
```

Artifacts land in `web/src-tauri/target/release/bundle/` (`.app` + `.dmg` on macOS, `.deb`/`.AppImage` on Linux, `.msi`/`.exe` on Windows). For iterating with hot reload:

```bash
make desktop-dev
```

**How it works**

- On launch the app picks a free loopback port, generates a fresh 48-character API token, and starts the bundled daemon with both. The token never leaves the machine and changes every launch, so nothing else running locally can drive the daemon.
- The web layer receives the port and token over Tauri IPC before the first request, so neither is hardcoded.
- The daemon is terminated when the app exits. A force-quit or crash never runs that handler, so the daemon also watches its stdin pipe and shuts itself down when the parent disappears — verified against `kill -9`.
- The tool sandbox defaults to your **home directory**, which is rarely what you mean. Pick the project folder from the sidebar (*Agent workspace → Change*), or set a different default:

  ```bash
  AGENTUI_WORKSPACE="$HOME/Projects" open -a "AgentUI Studio"
  ```

If the sidecar cannot start, the app falls back to `http://localhost:8080`, so a daemon you started yourself still works.

**Releases** are built by CI on tag push — macOS (Apple Silicon and Intel), Windows and Linux, each on its own runner, published as a draft GitHub release with installers attached. See [RELEASING.md](RELEASING.md). Builds are unsigned unless signing secrets are configured, so macOS and Windows will show a publisher warning on first launch.

---

## 📡 REST API

### Discover engines
`GET /api/v1/engines`
```json
{
  "engines": [
    { "name": "ollama", "url": "http://localhost:11434", "active": true, "models": ["llama3:8b"] },
    { "name": "lmstudio", "url": "http://localhost:1234", "active": false, "models": [] }
  ]
}
```

### List tools
`GET /api/v1/tools?profession=developer` — returns tool schemas, which tools are read-only, and the `execute_command` allowlist.

### Chat completions (SSE)
`POST /api/v1/chat/completions`

```json
{
  "engine": "ollama",
  "model": "llama3:8b",
  "messages": [{ "role": "user", "content": "What Go files are in this project?" }],
  "enabled_tools": ["list_dir", "read_file"],
  "tool_mode": "auto",
  "auto_approve_tools": ["list_dir", "read_file"],
  "temperature": 0.7,
  "max_tokens": 2048
}
```

`enabled_tools` names tools; the daemon resolves the schemas itself, so a client cannot inject arbitrary tool definitions.

`tool_mode` is `manual` (default — stream the tool calls and stop, letting the client gather approval) or `auto` (execute server-side and continue, up to 5 iterations). In `auto` mode, `auto_approve_tools` narrows what may run unattended: omit it and every enabled tool runs; provide it and any turn requesting something outside the list is streamed for approval instead, without executing any of that turn's calls.

**Stream output:**
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Let"}}]}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_dir","arguments":"{\"path\":\".\"}"}}]}}]}
data: {"object":"agentui.tool_result","tool_call_id":"call_1","name":"list_dir","output":"..."}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{}}],"usage":{"prompt_tokens":312,"completion_tokens":88}}
data: [DONE]
```

Errors that occur after the stream has started arrive as `data: {"error":"..."}` — the HTTP status is already committed by then.

### Settings
`GET /api/v1/settings` reports daemon capabilities; `POST` with `{"project_execution": true}` toggles build/run commands. Not exposed as a tool — a model cannot grant itself execution.

### Workspace
`GET /api/v1/workspace` returns the directory file tools are confined to, plus a shallow listing.
`POST /api/v1/workspace` with `{"path": "/abs/path"}` repoints them. Not exposed as a tool — only the UI can call it.

### Execute a tool
`POST /api/v1/tools/execute` — runs one approved tool call. Rate limited to 30/minute.

```json
{ "name": "list_dir", "arguments": "{\"path\":\".\"}", "tool_call_id": "call_1" }
```

---

## 🧪 Testing

```bash
make check
```

Or individually:

```bash
go test -cover -race ./...
cd web && npm test && npm run build
```

---

## 🐳 Docker

```bash
docker build -t agentui-studio .
docker run --rm -p 8080:8080 -v "$PWD":/workspace agentui-studio
```

The image serves the built frontend and the API from the same origin on `:8080`, and sandboxes tools to the mounted `/workspace`.

---

## 📄 License

MIT — see [LICENSE](LICENSE). Replace the copyright holder with your own name if you fork this.
