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
      assignments: { assignments: [{ id: 'c1', name: 'SLACK_CHANNEL', value: '__CFG_SLACK_CHANNEL__', type: 'string' }] }
    }
  },
  output: [{ SLACK_CHANNEL: 'qa-automation' }]
});

const format = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Format Alert', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf4/format-alert__ } },
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
