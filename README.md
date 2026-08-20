# 🚀 AgentUI Studio

A lightweight, zero-latency developer workspace for managing and interacting with local AI engines (**Ollama**, **LM Studio**, **vLLM**).

Built with **Go (Backend Daemon)** + **React 19, TypeScript & Tailwind CSS** + **Tauri 2 (Native Desktop Shell)**.

---

## 🌟 Key Features

- 🔍 **Zero-Config Auto-Discovery**: Automatically scans local ports (`:11434` for Ollama, `:1234` for LM Studio) and dynamically lists available models.
- ⚡ **Real-Time SSE Token Streaming**: Server-Sent Events streaming with time-to-first-token, duration, and engine-reported tokens/sec speedometer metrics.
- 🛠️ **Coding Agent Tools**: `list_tree`, `search_files`, `read_file`, `edit_file`, `write_file`, `move_file`, `delete_file`, and `execute_command` — real tool calling with every change surfaced for review as a side-by-side diff.
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
- **Linux**: `.AppImage` and `.deb` packages
- **Windows**: `.msi` and `.exe` installers

---

## 🔐 Security & Sandboxing

The daemon executes tools on your real machine with multi-layered containment:

1. **Strict Loopback Binding**: Binds exclusively to `127.0.0.1`. Binding to external interfaces requires an explicit `-api-token`.
2. **Workspace Sandboxing**: All file tools (`read_file`, `write_file`, `edit_file`, `list_dir`) are strictly sandboxed to the active workspace directory. Path traversal (`../`) and sensitive credential paths (`.env*`, `~/.ssh`, `~/.aws`, `*.pem`) are blocked.
3. **Execution Policy**: Command execution (`execute_command`) is restricted to a safe, read-only allowlist by default. Arbitrary command execution (building and running scripts) is opt-in and controlled from the Settings panel.
4. **Approval Control**:
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
