# Claude PTY Bridge

> **Unlock persistent, multi-turn conversations with Claude Code from any automated environment.**

Claude Code's interactive REPL mode refuses to start when it detects that
`stdout` is not a real terminal (TTY). This is a deliberate safety measure—but
it also blocks legitimate automation use-cases such as AI orchestrators,
CI pipelines, and background agents that want to maintain a **long-lived
session** instead of paying the heavy cold-start cost of `claude -p` on every
single request.

**Claude PTY Bridge** solves this by spawning a real pseudo-terminal (PTY) and
transparently proxying `stdin`/`stdout` through it. Claude Code sees a genuine
`xterm-256color` terminal and happily enters its interactive mode.

## The Problem

```
┌─────────────────┐    pipe (not a TTY)    ┌─────────────┐
│  Your Automation │ ──────────────────────▸│  Claude Code │ ✗ "Not a terminal!"
└─────────────────┘                        └─────────────┘
```

Every call to `claude -p "prompt"` spins up a **brand-new session**, which
means:

- 🔥 **No context caching** — the entire system prompt, tool definitions, and
  project files are re-sent from scratch every time.
- 💸 **~100K+ tokens per call** — even for trivial follow-up tasks.
- 🐢 **Slow cold starts** — each invocation takes seconds to initialise.

## The Solution

```
┌─────────────────┐   stdin/stdout (pipe)   ┌──────────────┐   PTY (real TTY!)   ┌─────────────┐
│  Your Automation │ ──────────────────────▸ │  PTY Bridge  │ ─────────────────▸  │  Claude Code │ ✓ Interactive!
└─────────────────┘                         └──────────────┘                     └─────────────┘
```

The bridge sits between your automation layer and Claude Code:

1. **Spawns a real PTY** via `node-pty` (the same library that powers
   VS Code's integrated terminal).
2. **Converts `\n` → `\r`** — Claude Code's Ink UI in raw mode only recognises
   `\r` (carriage return) as the "Enter" key. This single-byte conversion is
   the critical fix that makes automated input work.
3. **Strips ANSI escapes** — the colourful terminal output is cleaned into
   plain text for easy parsing by upstream consumers.

## Quick Start

### Option A — Run directly (requires Node.js ≥ 18)

```bash
# Clone & install
git clone https://github.com/YOUR_USERNAME/claude-pty-bridge.git
cd claude-pty-bridge
npm install

# Launch (auto-starts Claude in the current directory)
node bridge.js

# Launch in a specific project directory
node bridge.js /path/to/your/project
```

### Option B — Global install via npm

```bash
npm install -g claude-pty-bridge
claude-pty-bridge /path/to/your/project
```

### Option C — Standalone executable (no Node.js required)

Download the pre-built binary from the
[Releases](https://github.com/YOUR_USERNAME/claude-pty-bridge/releases) page:

| Platform | File |
|----------|------|
| Windows x64 | `claude-pty-bridge-win-x64.exe` |
| macOS x64 | `claude-pty-bridge-macos-x64` |
| Linux x64 | `claude-pty-bridge-linux-x64` |

```powershell
# Windows
.\claude-pty-bridge-win-x64.exe C:\my\project
```

> **Note:** Pre-built binaries bundle the Node.js runtime and the native
> `node-pty` addon. No other dependencies are needed.

## Usage

### Sending Input

Write to the bridge's `stdin`. Remember: **each message should end with a
newline** (`\n`). The bridge automatically converts it to `\r` for Claude
Code's Ink UI.

```python
import subprocess, time

proc = subprocess.Popen(
    ["node", "bridge.js", "/my/project"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
)

time.sleep(5)  # Wait for Claude to start

# First message
proc.stdin.write("Hello Claude! Please reply with 'received'.\n")
proc.stdin.flush()

# Read response
time.sleep(3)
output = proc.stdout.read1(4096).decode() if hasattr(proc.stdout, 'read1') else ""
print(output)

# Second message — same session, cached context!
proc.stdin.write("Now add a comment to line 42 of main.js.\n")
proc.stdin.flush()
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_COLS` | `120` | PTY width in columns |
| `BRIDGE_ROWS` | `30` | PTY height in rows |
| `BRIDGE_RAW` | `0` | Set to `1` to preserve raw ANSI output |
| `BRIDGE_NO_AUTOSTART` | `0` | Set to `1` to skip auto-launching Claude |

### CLI Arguments

```
node bridge.js [working_directory] [claude_binary]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `working_directory` | Current directory | Project path for Claude to operate in |
| `claude_binary` | `claude` | Path to Claude Code binary |

## Why This Matters

### Token Savings

| Mode | Tokens per task | Context Cache |
|------|----------------|---------------|
| `claude -p` (one-shot) | ~100K–1M | ❌ None (cold start every time) |
| PTY Bridge (persistent) | ~10K–50K | ✅ Full session cache |

In real-world testing, a 3-task workflow consumed **~300K tokens** with
one-shot mode vs **~80K tokens** with the PTY bridge — a **73% reduction**.

### How It Works Under the Hood

```
┌─ Your Automation ─┐
│                    │
│  stdin: "Hello\n"  │─────┐
│                    │     │
└────────────────────┘     │
                           ▼
┌─ bridge.js ────────────────────────────────┐
│                                            │
│  1. Receive "Hello\n" from stdin           │
│  2. Convert \n → \r  (critical fix!)       │
│  3. Write "Hello\r" to PTY                 │
│                                            │
│  ┌─ node-pty ──────────────────────┐       │
│  │  Virtual Terminal (xterm-256color)│      │
│  │  ┌──────────────────────────┐   │       │
│  │  │     Claude Code REPL     │   │       │
│  │  │  isTTY = true  ✓        │   │       │
│  │  │  Interactive mode: ON    │   │       │
│  │  └──────────────────────────┘   │       │
│  └─────────────────────────────────┘       │
│                                            │
│  4. Receive ANSI output from PTY           │
│  5. Strip escape codes                     │
│  6. Write clean text to stdout             │
│                                            │
└────────────────────────────────────────────┘
                           │
                           ▼
┌─ Your Automation ─┐
│                    │
│  stdout: "收到"     │
│                    │
└────────────────────┘
```

## Building from Source

```bash
# Install dependencies
npm install

# Build standalone executable (Windows)
npx @yao-pkg/pkg . --targets node20-win-x64 --output dist/claude-pty-bridge.exe
```

> **Important:** When distributing the standalone binary, you must also include
> the `node_modules/node-pty/build/Release/pty.node` file alongside it, as
> native addons cannot be fully embedded into a single executable.

## Requirements

- **Node.js** ≥ 18 (for source mode)
- **Claude Code** installed and authenticated (`claude` available in PATH)
- **Windows**: Node.js typically ships with prebuilt `node-pty` binaries. If
  compilation is triggered, you'll need Visual Studio Build Tools + Python.
- **macOS / Linux**: Xcode Command Line Tools or `build-essential` (usually
  already present).

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `node-pty` fails to install | Install build tools: `npm install -g windows-build-tools` (Windows) |
| Claude doesn't start | Ensure `claude` is in PATH, or pass the full path as the second argument |
| Input not submitting | Ensure your automation sends `\n` at the end of each message |
| Garbled output | Set `BRIDGE_RAW=1` to see raw terminal output for debugging |

## License

MIT

## Acknowledgements

- [node-pty](https://github.com/microsoft/node-pty) — Microsoft's
  pseudo-terminal library (powers VS Code's terminal)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's
  agentic coding assistant
