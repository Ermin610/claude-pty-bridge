# Claude PTY Bridge

> **Multi-agent orchestration engine for Claude Code — spawn parallel PTY
> sessions with YAML-driven workflows and human-in-the-loop checkpoints.**

## The Problem

Claude Code's interactive REPL refuses to start when `stdout` is not a real
terminal (TTY). This blocks automation. Worse, using `claude -p` for every
request wastes massive amounts of tokens due to zero context caching.

## The Solution

Claude PTY Bridge spawns a real pseudo-terminal via
[node-pty](https://github.com/microsoft/node-pty) (the same library powering
VS Code's terminal), tricking Claude Code into entering interactive mode.

**v2.0** extends this into a full **multi-agent workflow engine**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator (编排器)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Agent A   │  │ Agent B   │  │ Agent C   │  ← Independent  │
│  │ 📋 Planner│  │ 🔍 Review │  │ 💻 Coder  │    PTY sessions │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘                   │
│        ▼             ▼             ▼                         │
│  ┌─────────────────────────────────────────┐                 │
│  │         ⏸️ Checkpoint (Human Gate)       │                │
│  │  All agents pause → User reviews output │                 │
│  │  User types new instructions → Continue │                 │
│  └─────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Features

| Feature | v1.0 | v2.0 |
|---------|:----:|:----:|
| Single-agent persistent session | ✅ | ✅ |
| Multi-agent parallel execution | ❌ | ✅ |
| Role-based agents (planner/reviewer/coder) | ❌ | ✅ |
| YAML-driven workflow definitions | ❌ | ✅ |
| Human-in-the-loop checkpoints | ❌ | ✅ |
| Inter-agent data passing | ❌ | ✅ |
| Auto-approve code edits | ❌ | ✅ |
| Standalone `.exe` distribution | ✅ | ✅ |

## Quick Start

### Single Agent Mode (v1.0)

```bash
git clone https://github.com/Ermin610/claude-pty-bridge.git
cd claude-pty-bridge && npm install
node bridge.js /path/to/your/project
```

### Multi-Agent Workflow Mode (v2.0)

```bash
# Run a pre-built workflow
node orchestrator.js --workflow workflows/game-launch.yaml --cwd ./my-game

# Or use the global command
npm install -g claude-pty-bridge
claude-workflow --workflow workflows/game-launch.yaml --cwd ./my-game
```

## Writing Workflows

Workflows are defined in YAML with three concepts: **Agents**, **Stages**, and
**Checkpoints**.

```yaml
name: My Workflow

agents:
  planner:
    role: 📋 Planner
    system: You are a project planner. Always respond in Chinese.
  coder:
    role: 💻 Coder
    system: You are a senior developer.

stages:
  - name: Planning Phase
    parallel:                          # Run these tasks simultaneously
      - agent: planner
        task: Design the feature spec for user authentication.
    checkpoint:
      name: 📋 Plan Review
      message: Review the plan above. Type "continue" or your feedback.

  - name: Implementation Phase
    sequential:                        # Run these tasks one after another
      - agent: coder
        task: |
          Implement the feature based on this approved plan:
          {{agent:planner}}            # ← inject planner's output here
    checkpoint:
      name: 💻 Code Review
      message: Review the code changes.
```

### Template Variables

| Variable | Description |
|----------|-------------|
| `{{agent:ID}}` | Output from a specific agent |
| `{{prev_output}}` | Output from the previous stage |
| `{{user_feedback}}` | User's input from the last checkpoint |

### Checkpoint Behaviour

When a checkpoint is reached:

1. **All agents freeze** — no new input is sent
2. **Output is displayed** — formatted and cleaned for readability
3. **User must act** — type one of:
   - Feedback text → agents revise their work based on your notes
   - `通过` / `continue` → proceed to next stage
   - `终止` / `abort` → kill all agents and exit

## Pre-built Workflows

| File | Description |
|------|-------------|
| `workflows/game-launch.yaml` | Douyin mini-game launch: ad monetisation, gameplay polish, compliance review, and implementation |

## Architecture

```
claude-pty-bridge/
├── bridge.js          # Single-agent PTY core
├── agent-pool.js      # Multi-agent PTY pool manager
├── checkpoint.js      # Human-in-the-loop gate
├── workflow.js        # YAML parser + template engine
├── orchestrator.js    # Main CLI orchestrator
└── workflows/         # Pre-built workflow templates
    └── game-launch.yaml
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_COLS` | `120` | PTY width |
| `BRIDGE_ROWS` | `30` | PTY height |
| `BRIDGE_RAW` | `0` | Set to `1` to keep raw ANSI output |
| `BRIDGE_NO_AUTOSTART` | `0` | Set to `1` to skip auto-launching Claude |

## Requirements

- **Node.js** ≥ 18
- **Claude Code** installed and in PATH
- ~400MB RAM per agent (3 agents ≈ 1.2GB)

## License

MIT

## Acknowledgements

- [node-pty](https://github.com/microsoft/node-pty) — Microsoft's PTY library
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's
  agentic coding assistant
