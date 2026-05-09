#!/usr/bin/env node

/**
 * Claude PTY Bridge
 *
 * Spawns Claude Code inside a real pseudo-terminal (PTY) so that its
 * interactive Ink-based UI believes it is connected to a human terminal.
 *
 * This allows any automation layer (CI runners, AI orchestrators, background
 * agents) to hold a **persistent, multi-turn conversation** with Claude Code
 * instead of paying the heavy one-shot cost of `claude -p` every time.
 *
 * Key fix: stdin LF (0x0A) is converted to CR (0x0D) before being forwarded
 * to the PTY, because Claude Code's Ink framework only recognises CR as the
 * "Enter" key when running in raw mode.
 */

'use strict';

const pty   = require('node-pty');
const path  = require('path');

// ── Configuration ───────────────────────────────────────────────────────────
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';
const CWD   = process.argv[2] || process.cwd();     // optional: pass working dir as arg
const COLS  = parseInt(process.env.BRIDGE_COLS, 10) || 120;
const ROWS  = parseInt(process.env.BRIDGE_ROWS, 10) || 30;
const CLAUDE_CMD = process.argv[3] || 'claude';      // optional: custom claude binary path
const AUTO_START = process.env.BRIDGE_NO_AUTOSTART !== '1';
const STRIP_ANSI = process.env.BRIDGE_RAW !== '1';   // set BRIDGE_RAW=1 to keep ANSI

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip common ANSI escape sequences for cleaner piped output.
 */
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[?0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\].*?\x07/g, '')
    .replace(/\x1b\[>[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[<>].*?[a-zA-Z]/g, '')
    .replace(/\x1b\(B/g, '');
}

// ── Main ────────────────────────────────────────────────────────────────────
console.error('[bridge] Claude PTY Bridge v1.0.0');
console.error(`[bridge] Shell: ${SHELL}  CWD: ${CWD}  PTY: ${COLS}x${ROWS}`);
console.error(`[bridge] Auto-start Claude: ${AUTO_START}`);

const ptyProcess = pty.spawn(SHELL, [], {
  name: 'xterm-256color',
  cols: COLS,
  rows: ROWS,
  cwd:  path.resolve(CWD),
  env:  process.env,
});

// Forward PTY → stdout (with optional ANSI stripping)
ptyProcess.on('data', (data) => {
  if (STRIP_ANSI) {
    const clean = stripAnsi(data);
    if (clean.trim()) {
      process.stdout.write(clean);
    }
  } else {
    process.stdout.write(data);
  }
});

// Forward stdin → PTY  (LF → CR conversion is the critical fix)
process.stdin.on('data', (data) => {
  const converted = data.toString().replace(/\n/g, '\r');
  ptyProcess.write(converted);
});

// Propagate exit
ptyProcess.on('exit', (code) => {
  console.error(`[bridge] PTY exited with code ${code}`);
  process.exit(code ?? 0);
});

// Graceful shutdown
function shutdown() {
  console.error('[bridge] Shutting down…');
  try { ptyProcess.kill(); } catch (_) { /* already dead */ }
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// Auto-launch Claude inside the PTY after the shell is ready
if (AUTO_START) {
  setTimeout(() => {
    console.error(`[bridge] Launching: ${CLAUDE_CMD}`);
    ptyProcess.write(`${CLAUDE_CMD}\r`);
  }, 1500);
}
