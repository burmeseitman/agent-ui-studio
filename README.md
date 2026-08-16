# 🚀 AgentUI Studio

A lightweight, zero-latency developer workspace for managing and interacting with local AI engines (**Ollama**, **LM Studio**, **vLLM**).

Built with **Go (Backend Daemon)** + **React & Tauri (Frontend)**.

---

## 🌟 Key Features

- 🔍 **Zero-Config Auto-Discovery**: Automatically scans local ports (`:11434` for Ollama, `:1234` for LM Studio) and dynamically lists available models.
- ⚡ **Real-Time SSE Token Streaming**: Server-Sent Events streaming with time-to-first-token and engine-reported tokens/sec metrics.
- 🛠️ **Real Function Calling**: Tool schemas are sent to the model, and the model decides when to call them. Calls are surfaced for your approval before anything runs.
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
| `-shutdown-on-stdin-close` | off | Exit when stdin reaches EOF. Set by the desktop app so the daemon cannot outlive a force-quit |

---

## 🔐 Security Model

The daemon executes tools on your real machine, so the boundaries are deliberate:

- **Writes always require approval.** Tool autonomy is a three-way choice in the sidebar:
  - *Ask every time* — nothing runs without a click.
  - *Auto-run reads* (default) — inspection tools (`read_file`, `list_dir`, `fetch_url`, `analyze_readability`, `execute_command`) run unattended; `write_file` waits for you.
  - *Run everything* — full autonomy, for models and prompts you trust.

  The daemon enforces this, not the UI: it executes only what `auto_approve_tools` names, and a turn is judged as a whole — if a model asks for a read and a write together, the entire batch goes to you. A tool the daemon never advertised is never executed, whatever the engine returns.
- **`execute_command` never uses a shell.** Commands are parsed into argv and executed directly, so pipes, redirection, command substitution, chaining and globbing are rejected rather than interpreted. Only an allowlist of read-only binaries can run, and `git`/`go`/`npm` are further restricted to non-executing subcommands. Anything else you run yourself.
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
- The tool sandbox defaults to your **home directory**. Set `AGENTUI_WORKSPACE` to point it somewhere narrower:

  ```bash
  AGENTUI_WORKSPACE="$HOME/Projects" open -a "AgentUI Studio"
  ```

If the sidecar cannot start, the app falls back to `http://localhost:8080`, so a daemon you started yourself still works.

**Cross-platform builds** run in CI (`.github/workflows/desktop.yml`) on tag push, since each platform must be bundled on its own runner. `scripts/build-sidecar.sh` maps the Rust target triple to the right `GOOS`/`GOARCH`.

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
