import { workflow, node, trigger, sticky, newCredential, expr } from '@n8n/workflow-sdk';

const onError = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'On Workflow Error' },
  output: [{ execution: { id: '777', url: 'https://example.app.n8n.cloud/workflow/abc/executions/777', mode: 'trigger', lastNodeExecuted: 'Validate Spec JSON', error: { message: '[Spec Generator] schema mismatch (1): $.files needs >= 1 items' } }, workflow: { id: 'abc', name: 'QA | Design & Automate' } }]
});

const config = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: { assignments: [{ id: 'c1', name: 'SLACK_CHANNEL', value: '<SET_ME:SLACK_CHANNEL>', type: 'string' }] }
    }
  },
  output: [{ SLACK_CHANNEL: 'qa-automation' }]
});

const format = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Format Alert', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Error Trigger payload -> Slack alert (workflow, node, execution id, message). Handles trigger-level errors too.\n" +
      "const e = $input.first().json;\n" +
      "const exec = e.execution || {};\n" +
      "const trig = e.trigger || {};\n" +
      "const err = exec.error || trig.error || {};\n" +
      "const node = exec.lastNodeExecuted || err.node?.name || trig.error?.node?.name || 'n/a';\n" +
      "const msg = String(err.message || err.description || 'Unknown error').slice(0, 900);\n" +
      "const text = [\n" +
      "  `:rotating_light: *n8n workflow failed* \u2014 *${e.workflow?.name || 'unknown workflow'}*`,\n" +
      "  `\u2022 Workflow ID: \\`${e.workflow?.id || 'n/a'}\\``,\n" +
      "  `\u2022 Node: \\`${node}\\``,\n" +
      "  `\u2022 Execution ID: \\`${exec.id || 'n/a (trigger error)'}\\`${exec.url ? ` \u00b7 <${exec.url}|open execution>` : ''}`,\n" +
      "  `\u2022 Mode: ${exec.mode || trig.mode || 'n/a'}${exec.retryOf ? ` \u00b7 retry of ${exec.retryOf}` : ''}`,\n" +
      "  '\u2022 Error:',\n" +
      "  '```' + msg + '```',\n" +
      "].join('\\n');\n" +
      "return [{ json: { text, workflow: e.workflow?.name, node, execution_id: exec.id, message: msg } }];\n") } },
  output: [{ text: ':rotating_light: *n8n workflow failed*', workflow: 'QA | Design & Automate', node: 'Validate Spec JSON', execution_id: '777', message: 'schema mismatch' }]
});

const slack = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · Error Alert',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'message', operation: 'post', authentication: 'accessToken', select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      messageType: 'text',
      text: expr('{{ $json.text }}'),
      otherOptions: { includeLinkToWorkflow: false }
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ ok: true }]
});

const note = sticky('## QA | Error Handler (WF4)\nSet as the **Error workflow** of WF1–WF3 (Workflow settings → Error workflow). Fires on production executions only.\nPosts workflow name, failing node, execution ID (+ link) and the error message to Slack — including strict-JSON schema failures thrown by the validator Code nodes.', [], { color: 3 });

export default workflow('qa-error-handler', 'QA | Error Handler')
  .add(note)
  .add(onError)
  .to(config)
  .to(format)
  .to(slack);
