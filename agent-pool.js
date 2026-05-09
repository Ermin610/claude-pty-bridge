/**
 * Agent Pool — Manages multiple Claude Code PTY instances in parallel.
 *
 * Each "agent" is an independent Claude Code REPL running inside its own
 * pseudo-terminal, with a unique role, system prompt, and message history.
 */

'use strict';

const pty  = require('node-pty');
const path = require('path');

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[?0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\].*?\x07/g, '')
    .replace(/\x1b\[>[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[<>].*?[a-zA-Z]/g, '')
    .replace(/\x1b\(B/g, '');
}

/**
 * Heuristic: Claude Code's Ink UI shows `? for shortcuts` or `> ` prompt
 * when it's idle and ready for input. We look for these markers in recent
 * output to decide "the agent has finished responding".
 */
function isIdlePrompt(text) {
  const clean = stripAnsi(text).trim();
  return (
    clean.includes('? for shortcuts') ||
    clean.includes('● high') ||
    clean.includes('● low') ||
    clean.includes('● medium') ||
    /Brewed for|Cooked for|Crunched for|Whisked for|Crafted for/.test(clean)
  );
}

// ── Agent Class ─────────────────────────────────────────────────────────────

class Agent {
  /**
   * @param {string} id       — Unique identifier (e.g. 'planner')
   * @param {object} config
   * @param {string} config.role        — Display name (e.g. '策划师')
   * @param {string} config.system      — System prompt injected into first msg
   * @param {string} config.cwd         — Working directory
   * @param {string} [config.claudeCmd] — Claude binary path
   */
  constructor(id, config) {
    this.id        = id;
    this.role      = config.role || id;
    this.system    = config.system || '';
    this.cwd       = config.cwd || process.cwd();
    this.claudeCmd = config.claudeCmd || 'claude';
    this.ptyProc   = null;
    this.buffer    = '';       // rolling output buffer
    this.fullLog   = '';       // complete session log
    this.lastResponse = '';    // last Claude response text
    this.ready     = false;
    this.busy      = false;
    this._idleResolve = null;
    this._idleTimer   = null;
  }

  /** Spawn the PTY and auto-launch Claude inside it. */
  spawn() {
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';

      this.ptyProc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd:  path.resolve(this.cwd),
        env:  process.env,
      });

      this.ptyProc.on('data', (data) => {
        const clean = stripAnsi(data);
        this.buffer  += clean;
        this.fullLog += clean;

        // Detect when Claude is ready for input
        if (!this.ready && isIdlePrompt(data)) {
          this.ready = true;
          resolve();
        }

        // If we're waiting for a response to finish, detect idle
        if (this.busy && isIdlePrompt(data)) {
          // Debounce: wait 1.5s of silence to confirm it's truly idle
          clearTimeout(this._idleTimer);
          this._idleTimer = setTimeout(() => {
            this.busy = false;
            this.lastResponse = this.buffer;
            this.buffer = '';
            if (this._idleResolve) {
              this._idleResolve(this.lastResponse);
              this._idleResolve = null;
            }
          }, 2000);
        }
      });

      this.ptyProc.on('exit', (code) => {
        console.error(`[pool] Agent "${this.id}" exited with code ${code}`);
      });

      // Launch claude after shell boots
      setTimeout(() => {
        this.ptyProc.write(`${this.claudeCmd}\r`);
      }, 1500);

      // Fallback: resolve after 15s even if we don't see the prompt
      setTimeout(() => {
        if (!this.ready) {
          this.ready = true;
          resolve();
        }
      }, 15000);
    });
  }

  /**
   * Send a message to this agent and wait for the complete response.
   * @param {string} message — The task / instruction to send
   * @param {number} [timeoutMs=120000] — Max wait time
   * @returns {Promise<string>} — The agent's full response text
   */
  send(message, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      if (!this.ready || !this.ptyProc) {
        return reject(new Error(`Agent "${this.id}" is not ready.`));
      }

      this.busy   = true;
      this.buffer = '';

      // Send the message via PTY (convert \n → \r for Ink)
      const converted = message.replace(/\n/g, ' ') + '\r';
      this.ptyProc.write(converted);

      // Auto-approve any edit prompts (send Enter periodically)
      const autoApprover = setInterval(() => {
        if (this.buffer.includes('Do you want to make this edit') ||
            this.buffer.includes('1. Yes')) {
          this.ptyProc.write('\r');
        }
      }, 2000);

      this._idleResolve = (response) => {
        clearInterval(autoApprover);
        clearTimeout(timeout);
        resolve(response);
      };

      const timeout = setTimeout(() => {
        clearInterval(autoApprover);
        this.busy = false;
        this.lastResponse = this.buffer;
        this.buffer = '';
        if (this._idleResolve) {
          this._idleResolve = null;
          resolve(this.lastResponse + '\n[TIMEOUT: Agent did not finish in time]');
        }
      }, timeoutMs);
    });
  }

  /** Gracefully shut down this agent. */
  kill() {
    if (this.ptyProc) {
      // Send /exit to Claude, then kill the PTY
      this.ptyProc.write('/exit\r');
      setTimeout(() => {
        try { this.ptyProc.kill(); } catch (_) {}
      }, 2000);
    }
  }
}

// ── Pool Class ──────────────────────────────────────────────────────────────

class AgentPool {
  constructor() {
    /** @type {Map<string, Agent>} */
    this.agents = new Map();
  }

  /**
   * Spawn a new agent.
   * @param {string} id
   * @param {object} config — See Agent constructor
   * @returns {Promise<Agent>}
   */
  async spawn(id, config) {
    if (this.agents.has(id)) {
      throw new Error(`Agent "${id}" already exists in pool.`);
    }
    const agent = new Agent(id, config);
    this.agents.set(id, agent);
    console.error(`[pool] Spawning agent "${id}" (${config.role})…`);
    await agent.spawn();
    console.error(`[pool] Agent "${id}" is ready.`);
    return agent;
  }

  /**
   * Send a message to a specific agent.
   * @param {string} id
   * @param {string} message
   * @returns {Promise<string>}
   */
  async send(id, message) {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent "${id}" not found.`);
    console.error(`[pool] Sending task to "${id}"…`);
    const response = await agent.send(message);
    console.error(`[pool] Agent "${id}" finished (${response.length} chars).`);
    return response;
  }

  /**
   * Send tasks to multiple agents in parallel.
   * @param {Array<{id: string, message: string}>} tasks
   * @returns {Promise<Map<string, string>>}
   */
  async parallel(tasks) {
    const results = new Map();
    const promises = tasks.map(async ({ id, message }) => {
      const response = await this.send(id, message);
      results.set(id, response);
    });
    await Promise.all(promises);
    return results;
  }

  /** Get an agent by ID. */
  get(id) {
    return this.agents.get(id);
  }

  /** Shut down all agents. */
  async killAll() {
    console.error('[pool] Shutting down all agents…');
    for (const [id, agent] of this.agents) {
      console.error(`[pool] Killing agent "${id}"…`);
      agent.kill();
    }
    this.agents.clear();
  }
}

module.exports = { Agent, AgentPool };
