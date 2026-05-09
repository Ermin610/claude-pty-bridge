/**
 * Checkpoint — Human-in-the-Loop decision gate.
 *
 * Pauses the entire workflow, presents a formatted summary to the user,
 * and waits for their explicit input before proceeding.
 */

'use strict';

const readline = require('readline');

/**
 * Display a checkpoint and wait for user input.
 *
 * @param {object}   opts
 * @param {string}   opts.name         — Checkpoint title (e.g. '📋 策划方案审阅')
 * @param {string}   opts.message      — Instructions for the user
 * @param {Map<string,string>} opts.agentOutputs — Map of agentId → output
 * @param {object}   opts.agentRoles   — Map of agentId → display role name
 * @returns {Promise<{action: string, input: string}>}
 *   action: 'continue' | 'modify' | 'abort'
 *   input:  the raw text the user typed
 */
async function checkpoint({ name, message, agentOutputs, agentRoles }) {
  const divider = '═'.repeat(60);
  const thinDiv = '─'.repeat(60);

  console.log('\n' + divider);
  console.log(`  ⏸️  断点：${name}`);
  console.log(divider);

  // Show each agent's output
  if (agentOutputs && agentOutputs.size > 0) {
    for (const [agentId, output] of agentOutputs) {
      const role = (agentRoles && agentRoles[agentId]) || agentId;
      console.log(`\n  【${role}】的输出：`);
      console.log(thinDiv);

      // Clean and indent the output
      const lines = output
        .split('\n')
        .filter(l => {
          const t = l.trim();
          // Filter out PTY noise
          return t.length > 0 &&
                 !t.includes('for shortcuts') &&
                 !t.includes('esc to interrupt') &&
                 !t.includes('ctrl+g') &&
                 !t.includes('Nucleating') &&
                 !t.includes('Whisking') &&
                 !t.includes('Brewing') &&
                 !t.includes('Crafting') &&
                 !t.includes('Computing') &&
                 !t.includes('Crunching') &&
                 !t.includes('thinking)') &&
                 !t.includes('tokens ·') &&
                 !t.startsWith('[BRIDGE]') &&
                 !t.startsWith('[CLAUDE]');
        })
        .map(l => '  ' + l);

      console.log(lines.join('\n'));
      console.log(thinDiv);
    }
  }

  // Show the checkpoint message
  if (message) {
    console.log(`\n  ${message.trim()}`);
  }

  console.log('\n' + divider);
  console.log('  🔴 所有 Agent 已暂停。请输入您的指令：');
  console.log('');
  console.log('  • 输入修改意见 → Agent 将根据您的反馈修改');
  console.log('  • 输入 "通过" 或 "continue" → 进入下一阶段');
  console.log('  • 输入 "终止" 或 "abort" → 结束整个工作流');
  console.log(divider);

  // Read user input
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('  您的指令: ', (answer) => {
      rl.close();

      const trimmed = answer.trim();

      if (trimmed === '通过' || trimmed.toLowerCase() === 'continue' || trimmed === '') {
        resolve({ action: 'continue', input: trimmed });
      } else if (trimmed === '终止' || trimmed.toLowerCase() === 'abort') {
        resolve({ action: 'abort', input: trimmed });
      } else {
        resolve({ action: 'modify', input: trimmed });
      }
    });
  });
}

module.exports = { checkpoint };
