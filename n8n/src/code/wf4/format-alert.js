// Error Trigger payload -> Slack alert (workflow, node, execution id, message). Handles trigger-level errors too.
const e = $input.first().json;
const exec = e.execution || {};
const trig = e.trigger || {};
const err = exec.error || trig.error || {};
const node = exec.lastNodeExecuted || err.node?.name || trig.error?.node?.name || 'n/a';
const msg = String(err.message || err.description || 'Unknown error').slice(0, 900);
const text = [
  `:rotating_light: *n8n workflow failed* — *${e.workflow?.name || 'unknown workflow'}*`,
  `• Workflow ID: \`${e.workflow?.id || 'n/a'}\``,
  `• Node: \`${node}\``,
  `• Execution ID: \`${exec.id || 'n/a (trigger error)'}\`${exec.url ? ` · <${exec.url}|open execution>` : ''}`,
  `• Mode: ${exec.mode || trig.mode || 'n/a'}${exec.retryOf ? ` · retry of ${exec.retryOf}` : ''}`,
  '• Error:',
  '```' + msg + '```',
].join('\n');
return [{ json: { text, workflow: e.workflow?.name, node, execution_id: exec.id, message: msg } }];
