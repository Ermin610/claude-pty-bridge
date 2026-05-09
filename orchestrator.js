#!/usr/bin/env node

/**
 * Orchestrator — The brain of the multi-agent workflow engine.
 *
 * Usage:
 *   node orchestrator.js --workflow workflows/game-launch.yaml --cwd ./project
 *
 * Reads a YAML workflow, spawns the defined agents in parallel PTY sessions,
 * executes stages (parallel or sequential), and pauses at checkpoints for
 * human review and decision-making.
 */

'use strict';

const path = require('path');
const { AgentPool }    = require('./agent-pool');
const { checkpoint }   = require('./checkpoint');
const { loadWorkflow, resolveTemplate } = require('./workflow');

// ── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    workflow: null,
    cwd:      process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workflow' && args[i + 1]) {
      opts.workflow = args[++i];
    } else if (args[i] === '--cwd' && args[i + 1]) {
      opts.cwd = args[++i];
    } else if (!opts.workflow) {
      opts.workflow = args[i];
    }
  }

  if (!opts.workflow) {
    console.error('Usage: node orchestrator.js --workflow <path.yaml> [--cwd <dir>]');
    process.exit(1);
  }

  return opts;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const wf   = loadWorkflow(opts.workflow);
  const pool = new AgentPool();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║  🚀 工作流启动：${wf.name}`);
  console.log(`║  📁 工作目录：${path.resolve(opts.cwd)}`);
  console.log(`║  🤖 Agent 数量：${Object.keys(wf.agents).length}`);
  console.log(`║  📋 阶段数量：${wf.stages.length}`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // ── Phase 1: Spawn all agents ───────────────────────────────────────────
  console.log('┌── 正在启动所有 Agent ──────────────────────────────────────┐');

  const agentRoles = {};
  const spawnPromises = [];

  for (const [agentId, agentDef] of Object.entries(wf.agents)) {
    agentRoles[agentId] = agentDef.role || agentId;
    spawnPromises.push(
      pool.spawn(agentId, {
        role:     agentDef.role,
        system:   agentDef.system || '',
        cwd:      opts.cwd,
      })
    );
  }

  await Promise.all(spawnPromises);
  console.log('└── 所有 Agent 已就绪 ──────────────────────────────────────┘\n');

  // ── Phase 2: Inject system prompts ────────────────────────────────────
  console.log('┌── 注入角色设定 ────────────────────────────────────────────┐');
  for (const [agentId, agentDef] of Object.entries(wf.agents)) {
    if (agentDef.system) {
      const systemMsg = `请记住你的角色设定：${agentDef.system.trim()} 请用中文回复所有内容。确认收到请回复"收到"。`;
      await pool.send(agentId, systemMsg);
      console.log(`  ✅ ${agentRoles[agentId]} (${agentId}) — 角色注入完成`);
    }
  }
  console.log('└── 角色设定完成 ────────────────────────────────────────────┘\n');

  // ── Phase 3: Execute stages ───────────────────────────────────────────
  let prevOutput     = '';
  let userFeedback   = '';
  let agentOutputs   = new Map();

  for (let si = 0; si < wf.stages.length; si++) {
    const stage = wf.stages[si];

    console.log('\n' + '█'.repeat(60));
    console.log(`  📌 阶段 ${si + 1}/${wf.stages.length}：${stage.name}`);
    console.log('█'.repeat(60) + '\n');

    const context = { prevOutput, userFeedback, agentOutputs };

    // ── Execute tasks (parallel or sequential) ─────────────────────────
    const stageOutputs = new Map();

    if (stage.parallel) {
      // Parallel execution
      const tasks = stage.parallel.map((t) => ({
        id:      t.agent,
        message: resolveTemplate(t.task, context),
      }));
      const results = await pool.parallel(tasks);
      for (const [id, output] of results) {
        stageOutputs.set(id, output);
        agentOutputs.set(id, output);
      }
    }

    if (stage.sequential) {
      // Sequential execution
      for (const t of stage.sequential) {
        const task = resolveTemplate(t.task, context);
        const output = await pool.send(t.agent, task);
        stageOutputs.set(t.agent, output);
        agentOutputs.set(t.agent, output);
        // Update context for next sequential task
        prevOutput = output;
        context.prevOutput = prevOutput;
      }
    }

    // ── Checkpoint ─────────────────────────────────────────────────────
    if (stage.checkpoint) {
      const result = await checkpoint({
        name:         stage.checkpoint.name,
        message:      stage.checkpoint.message,
        agentOutputs: stageOutputs,
        agentRoles:   agentRoles,
      });

      if (result.action === 'abort') {
        console.log('\n⛔ 工作流已被用户终止。');
        await pool.killAll();
        process.exit(0);
      }

      if (result.action === 'modify') {
        userFeedback = result.input;
        console.log(`\n📝 收到修改意见：${userFeedback}`);
        console.log('   将在下一阶段中注入此反馈…\n');

        // Re-run this stage with user feedback
        // Send feedback to all agents involved in this stage
        const involvedAgents = [
          ...(stage.parallel  || []).map(t => t.agent),
          ...(stage.sequential || []).map(t => t.agent),
        ];

        for (const agentId of involvedAgents) {
          const feedbackMsg = `用户对你上一轮的输出有以下修改意见，请根据反馈重新修改你的方案：\n\n${userFeedback}\n\n请用中文输出修改后的完整方案。`;
          const revised = await pool.send(agentId, feedbackMsg);
          stageOutputs.set(agentId, revised);
          agentOutputs.set(agentId, revised);
        }

        // Show revised output at another checkpoint
        const recheck = await checkpoint({
          name:         stage.checkpoint.name + ' (修改后)',
          message:      '以上是根据您反馈修改后的方案。',
          agentOutputs: stageOutputs,
          agentRoles:   agentRoles,
        });

        if (recheck.action === 'abort') {
          console.log('\n⛔ 工作流已被用户终止。');
          await pool.killAll();
          process.exit(0);
        }

        userFeedback = recheck.input || '';
      } else {
        userFeedback = '';
      }

      // Update prevOutput for next stage
      prevOutput = [...stageOutputs.values()].join('\n\n---\n\n');
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ 工作流已全部完成！');
  console.log('═'.repeat(60));

  await pool.killAll();
  process.exit(0);
}

// ── Entry ───────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
