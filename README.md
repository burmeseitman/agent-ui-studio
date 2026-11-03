# 🚀 AgentUI Studio

A lightweight, zero-latency developer workspace for managing and interacting with local AI engines (**Ollama**, **LM Studio**, **vLLM**).

Built with **Go (Backend Daemon)** + **React 19, TypeScript & Tailwind CSS** + **Tauri 2 (Native Desktop Shell)**.

---

## 🌟 Key Features

- 🔍 **Zero-Config Auto-Discovery**: Automatically scans local ports (`:11434` for Ollama, `:1234` for LM Studio) and dynamically lists available models.
- ⚡ **Real-Time SSE Token Streaming**: Server-Sent Events streaming with time-to-first-token, duration, and engine-reported tokens/sec speedometer metrics.
- 🛠️ **Real Agent Tools**: `list_tree`, `list_dir`, `search_files`, `read_file`, `edit_file`, `write_file`, `move_file`, `delete_file` and `execute_command` for code, plus `fetch_url` and `analyze_readability` for research and writing — genuine tool calling, with every change surfaced for review as a side-by-side diff. Each persona is handed only the subset it needs.
- 🖥️ **Live In-App Web App & HTML Preview**: Instant interactive preview panel for HTML/CSS/JS web apps, calculators, and UI components:
  - **Sandboxed `iframe`** with automatic local CSS/JS asset inlining.
  - **Device Viewport Switcher**: Responsive (100%), Desktop (1024px), Tablet (768px), and Mobile (375px).
  - **Runtime Console & Debugger Drawer**: Captures in-app logs (`console.log`, `info`, `warn`, `error`) and exceptions.
  - **1-Click Launchers**: Open preview from Header button, Tool Call cards, or Markdown code blocks.
- 💾 **Persistent Workspace Folder**: Automatically remembers and restores your selected project directory across desktop app restarts.
- 🎛️ **Dynamic Model Adapter & Recovery**: Routes chat completions to native Ollama (`/api/chat`) and OpenAI-compatible engines (`/v1/chat/completions`), recovering plain-text tool calls emitted by smaller models.
- 💬 **Multiple Conversations**: Named, switchable chat sessions kept in the browser with automatic title generation and history pruning.
- 🎨 **Considered Interface**: Dark, low-chroma palette with bundled Inter and JetBrains Mono fonts, native macOS title bar, syntax highlighting, and collapsible code blocks.
- 📦 **Native Desktop App**: Tauri build bundling the Go daemon as an embedded sidecar — double-click to run, no terminal or server setup required.

---

## 📥 Install

Grab an installer from the
[latest release](https://github.com/burmeseitman/agent-ui-studio/releases/latest):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `AgentUI.Studio_<version>_aarch64.dmg` |
| macOS (Intel) | `AgentUI.Studio_<version>_x64.dmg` |
| Windows | `AgentUI.Studio_<version>_x64-setup.exe` |
| Linux | `AgentUI.Studio_<version>_amd64.AppImage`, `.deb` or `.rpm` |

The Go daemon is bundled inside the app, so there is nothing else to install —
point it at a workspace folder and a running engine and it works.

These builds are **not notarised**, so the first launch needs one extra step:
on macOS right-click the app and choose *Open*, and on Windows choose
*More info → Run anyway* when SmartScreen warns.

> **v0.1.1 and earlier on macOS**: those bundles were built without a signing
> identity, which leaves the signature itself invalid — macOS calls the app
> damaged and offers to move it to the Trash, and neither *Open* nor clearing
> the quarantine attribute helps. Repair a downloaded copy with:
>
> ```bash
> codesign --force --deep --sign - "/Applications/AgentUI Studio.app"
> xattr -dr com.apple.quarantine "/Applications/AgentUI Studio.app"
> ```
>
> Releases after v0.1.1 are ad-hoc signed by CI and need neither command.

[RELEASING.md](RELEASING.md) covers signing and what each tag build attaches.

---

## 🛠️ Architecture

```
AgentUI Studio
├── web/                       # React 19 + Vite + Tailwind CSS + Tauri 2
│   ├── src/                   # UI components, SSE client, live preview, hooks
│   └── src-tauri/             # Tauri native desktop wrapper & IPC sidecar bridge
├── engine/                    # Engine discovery workers (Ollama, LM Studio, vLLM)
├── adapter/                   # Unified streaming chat + tool-call adapter
├── tools/                     # Tool registry, sandboxed file executors, exec policy
├── api/                       # REST API handlers, agent loop, CORS & token auth
└── main.go                    # Daemon entry point & graceful shutdown
```

---

## 🚀 Quick Start

### 1. Choosing a Model

Switching presets automatically configures the system prompt, tool set, and best installed model:

| Persona | Prefers | Description |
| --- | --- | --- |
| **Developer** | Tool-capable code model | Has file tools (`read_file`, `edit_file`, `write_file`, etc.) enabled to read, write, build, and debug projects. |
| **Content Writer** | General instruct model | Tuned for prose and structured documentation. |
| **Researcher** | Long-context general model | Tuned for in-depth analysis and exploration. |
| **Custom** | Most capable installed model | Unrestricted custom prompt and tool configuration. |

Good local starting models for coding agent tasks:
```bash
ollama pull qwen2.5-coder:7b
# or
ollama pull llama3.1:8b
```

### 2. Development Setup

#### Start Backend Daemon
```bash
go run .
```

#### Start Web Frontend
```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

#### Single-Origin Web Server
```bash
make build-web
go run . -static-dir web/dist
```

### 3. Configuration

The daemon is zero-config for local use; every flag has a working default.

| Flag | Default | Purpose |
| --- | --- | --- |
| `-port` | `8080` | Listening port |
| `-host` | `127.0.0.1` | Listening interface — anything else requires a token |
| `-api-token` | _(empty)_ | Bearer token required on every API call |
| `-workspace` | current directory | Root the file tools are sandboxed to |
| `-static-dir` | `web/dist` | Built frontend to serve (empty to run API-only) |
| `-allowed-origins` | _(same-origin)_ | Comma-separated extra CORS origins |
| `-allow-project-execution` | `false` | Widen the command allowlist to build and run commands |
| `-ollama-url` | `http://localhost:11434` | Ollama base URL |
| `-lmstudio-url` | `http://localhost:1234` | LM Studio base URL |
| `-timeout` | `1500` | Engine discovery probe timeout (ms) |
| `-shutdown-on-stdin-close` | `false` | Exit when stdin closes (used by the desktop shell) |

`PORT`, `AGENTUI_TOKEN`, `OLLAMA_URL` and `LMSTUDIO_URL` set the same values from
the environment; the matching flag wins when both are given.

---

## 🐳 Docker

The image builds the frontend and the daemon and serves both from one origin:

```bash
docker build -t agentui-studio .
docker run -p 8080:8080 \
  -e AGENTUI_TOKEN="$(openssl rand -hex 24)" \
  -v "$PWD:/workspace" \
  agentui-studio
```

The container binds `0.0.0.0` so the published port is reachable, and the daemon
refuses to start that way without a token — hence `AGENTUI_TOKEN`. Mount the
project you want the agent to work on at `/workspace`; the file tools cannot
reach outside it. Engines are expected on the host, at
`host.docker.internal` — that name resolves on Docker Desktop; on Linux add
`--add-host=host.docker.internal:host-gateway`.

---

## 🖥️ Desktop Application (Tauri)

The desktop app bundles the Go daemon as a native sidecar binary:

```bash
# Build the native macOS/Windows/Linux app
make desktop

# Run desktop app in development mode with hot reloading
make desktop-dev
```

Release packages land in `web/src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` installer and `.app` bundle
- **Linux**: `.AppImage`, `.deb` and `.rpm` packages
- **Windows**: `.msi` and NSIS `.exe` installers

Published releases carry the NSIS `.exe` only — see
[RELEASING.md](RELEASING.md) for what each tag build attaches.

---

## 🔐 Security & Sandboxing

The daemon executes tools on your real machine with multi-layered containment:

1. **Strict Loopback Binding**: Binds exclusively to `127.0.0.1`. Binding to external interfaces requires an explicit `-api-token`.
2. **Workspace Sandboxing**: All file tools (`read_file`, `write_file`, `edit_file`, `list_dir`) are strictly sandboxed to the active workspace directory. Path traversal (`../`) and sensitive credential paths (`.env*`, `~/.ssh`, `~/.aws`, `*.pem`) are blocked.
3. **Execution Policy**: Command execution (`execute_command`) is restricted to a safe, read-only allowlist by default. Arbitrary command execution (building and running scripts) is opt-in and controlled from the Settings panel.
4. **Outbound Request Filtering**: `fetch_url` is the only tool that leaves your
   machine. Loopback, private, link-local and unspecified addresses are rejected
   at dial time — after DNS resolution and again on every redirect — so a public
   hostname cannot be pointed at your LAN or a cloud metadata endpoint.
5. **Approval Control**:
   - *Ask every time*: All tool calls require explicit manual approval.
   - *Auto-run reads* (default): Read-only inspection tools run automatically; file modifications and writes wait for your approval as a visual diff.
   - *Run everything*: Full autonomy.

---

## 📡 REST API Reference

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/v1/engines` | `GET` | Discover local engines and active models |
| `/api/v1/tools` | `GET` | List available tools and execution policy |
| `/api/v1/chat/completions` | `POST` | Stream chat completion and tool calls (SSE) |
| `/api/v1/tools/execute` | `POST` | Execute an approved tool call |
| `/api/v1/workspace` | `GET` / `POST` | Inspect or update the active workspace path |
| `/api/v1/settings` | `GET` / `POST` | Query or update daemon execution capabilities |
| `/health` | `GET` | Health check & authentication status |

---

## 🧪 Testing & Validation

Run the entire end-to-end verification suite:

```bash
make check
```

Or run backend and frontend test suites individually:
```bash
# Go unit tests with race detector
go test -cover -race ./...

# Frontend Vitest test suite and type check
cd web && npm test && npm run build
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
