/**
 * Workflow Engine — Parses YAML workflow definitions and drives execution.
 */

'use strict';

const yaml = require('js-yaml');
const fs   = require('fs');
const path = require('path');

/**
 * Load and parse a YAML workflow file.
 * @param {string} filePath — Path to the .yaml file
 * @returns {object} — Parsed workflow definition
 */
function loadWorkflow(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const wf  = yaml.load(raw);

  // Validate required fields
  if (!wf.name)   throw new Error('Workflow missing "name" field.');
  if (!wf.agents) throw new Error('Workflow missing "agents" field.');
  if (!wf.stages) throw new Error('Workflow missing "stages" field.');

  return wf;
}

/**
 * Resolve template variables in a task string.
 * Supported: {{prev_output}}, {{user_feedback}}, {{agent:ID}}
 *
 * @param {string} template — Task string with placeholders
 * @param {object} context  — Variable values
 * @returns {string}
 */
function resolveTemplate(template, context) {
  let result = template;

  if (context.prevOutput) {
    result = result.replace(/\{\{prev_output\}\}/g, context.prevOutput);
  }
  if (context.userFeedback) {
    result = result.replace(/\{\{user_feedback\}\}/g, context.userFeedback);
  }
  if (context.agentOutputs) {
    for (const [id, output] of context.agentOutputs) {
      result = result.replace(new RegExp(`\\{\\{agent:${id}\\}\\}`, 'g'), output);
    }
  }

  return result;
}

module.exports = { loadWorkflow, resolveTemplate };
