import { workflow, node, trigger, sticky, newCredential, ifElse, switchCase, splitInBatches, nextBatch, languageModel, expr } from '@n8n/workflow-sdk';

const manualRun = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Run Manually' }, output: [{}] });

const daily = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: { name: 'Daily 10:00 Asia/Karachi', parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 10, triggerAtMinute: 0 }] } } },
  output: [{}]
});

const config = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'c1', name: 'JIRA_PROJECT', value: '__CFG_JIRA_PROJECT__', type: 'string' },
          { id: 'c2', name: 'JIRA_BASE_URL', value: '__CFG_JIRA_BASE_URL__', type: 'string' },
          { id: 'c3', name: 'GITHUB_OWNER', value: '__CFG_GITHUB_OWNER__', type: 'string' },
          { id: 'c4', name: 'GITHUB_REPO', value: '__CFG_GITHUB_REPO__', type: 'string' },
          { id: 'c5', name: 'BASE_BRANCH', value: 'main', type: 'string' },
          { id: 'c6', name: 'SLACK_CHANNEL', value: '__CFG_SLACK_CHANNEL__', type: 'string' },
          { id: 'c7', name: 'BUG_SHEET_ID', value: '__CFG_BUG_SHEET_ID__', type: 'string' },
          { id: 'c8', name: 'BUG_SHEET_TAB', value: 'Bugs', type: 'string' }
        ]
      }
    }
  },
  output: [{ JIRA_PROJECT: 'PROJ', JIRA_BASE_URL: 'https://example.atlassian.net', GITHUB_OWNER: 'acme', GITHUB_REPO: 'webapp', BASE_BRANCH: 'main', SLACK_CHANNEL: 'qa-automation', BUG_SHEET_ID: 'sheet123', BUG_SHEET_TAB: 'Bugs' }]
});

const searchFixed = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Bugs in Fixed',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issue', operation: 'getAll', returnAll: true,
      options: {
        jql: expr('project = "{{ $json.JIRA_PROJECT }}" AND issuetype = Bug AND status = "Fixed" ORDER BY priority DESC, updated ASC'),
        fields: 'summary,description,labels,components,priority,status,fixVersions'
      }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ key: 'PROJ-131', fields: { summary: 'Expired coupon SUMMER2025 is accepted at checkout', labels: ['qa-automation', 'checkout-coupon'], status: { name: 'Fixed' } } }]
});

const normalizeBugs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Normalize Bugs', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/normalize-bugs__ } },
  output: [{ key: 'PROJ-131', summary: 'Expired coupon SUMMER2025 is accepted at checkout', description: '...', labels: ['qa-automation', 'checkout-coupon'], components: ['Checkout'], priority: 'High', status: 'Fixed', fix_versions: [] }]
});

const loopBugs = splitInBatches({ version: 3, config: { name: 'Loop Bugs', parameters: { batchSize: 1 } } });

const currentBug = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Current Bug' },
  output: [{ key: 'PROJ-131', summary: 'Expired coupon SUMMER2025 is accepted at checkout', labels: ['qa-automation', 'checkout-coupon'] }]
});

const getComments = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Get Comments',
    __HTTP_RETRY__
    parameters: {
      method: 'GET',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/2/issue/{{ $json.key }}/comment?orderBy=-created&maxResults=30'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ comments: [{ author: { displayName: 'Dev' }, created: '2026-10-15T10:00:00Z', body: 'Fixed in PR #212, deployed to QA build 2026.10.15-3' }] }]
});

const getLinks = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Get Remote Links',
    alwaysOutputData: true,
    __HTTP_RETRY__
    parameters: {
      method: 'GET',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/2/issue/{{ $("Current Bug").last().json.key }}/remotelink'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ object: { title: 'acme/webapp#212 Fix coupon expiry check', url: 'https://github.com/acme/webapp/pull/212' } }]
});

const sheetFind = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Bug Sheet · Find Row',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet', operation: 'read', authentication: 'oAuth2',
      documentId: { __rl: true, mode: 'id', value: expr('{{ $("Config").first().json.BUG_SHEET_ID }}') },
      sheetName: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.BUG_SHEET_TAB }}') },
      filtersUI: { values: [{ lookupColumn: 'Jira Key', lookupValue: expr('{{ $("Current Bug").last().json.key }}') }] },
      options: { returnFirstMatch: true }
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets (BUG_SHEET_ID)') }
  },
  output: [{ 'Jira Key': 'PROJ-131', Module: 'checkout-coupon', Severity: 'S2', Browser: 'chromium', 'Regression Test ID': 'TC-02', 'Source Ticket': 'PROJ-101' }]
});

const verifyContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Verification Context', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/verification-context__ } },
  output: [{ bug: { key: 'PROJ-131' }, comments: [], links: [], sheet_row: null }]
});

const verifyModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Verification (t=0)',
    parameters: { model: { __rl: true, mode: 'id', value: '__MODEL_ID__' }, options: { temperature: 0, maxTokensToSample: 4000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const verifyAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Fix Verification Agent',
    parameters: {
      promptType: 'define',
      text: expr('Plan the verification of this Fixed bug. Return STRICT JSON per the runtime contract.\n\nJIRA BUG:\n{{ JSON.stringify($json.bug, null, 1) }}\n\nRECENT COMMENTS (newest first):\n{{ JSON.stringify($json.comments, null, 1) }}\n\nREMOTE LINKS (PRs / commits):\n{{ JSON.stringify($json.links, null, 1) }}\n\nBUG SHEET ROW:\n{{ JSON.stringify($json.sheet_row, null, 1) }}'),
      options: { systemMessage: __PROMPT:fix-verification__, maxIterations: 3 }
    },
    subnodes: { model: verifyModel }
  },
  output: [{ output: '{"bug_key":"PROJ-131","ready":true,"not_ready_reason":null,"module":"checkout-coupon","grep":"@checkout-coupon","repeat_each":10,"projects":["chromium","firefox","webkit"],"original_steps":[],"regression_test_exists":true,"regression_test_hint":"TC-02","build":"2026.10.15-3"}' }]
});

const validateVerify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Verification JSON', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/validate-verification__ } },
  output: [{ bug: { key: 'PROJ-131' }, plan: { ready: true, grep: '@checkout-coupon', repeat_each: 10, projects: ['chromium'], build: '2026.10.15-3', not_ready_reason: null } }]
});

const isReady = ifElse({
  version: 2.3,
  config: {
    name: 'Fix Deployed & Ready?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.plan.ready }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const commentBlocked = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Comment NOT READY',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issueComment', operation: 'add',
      issueKey: expr('{{ $json.bug.key }}'),
      comment: expr('Verification — BLOCKED (status stays Fixed)\nNOT READY — {{ $json.plan.not_ready_reason }}\nQA automation will retry on the next daily run (10:00 PKT).')
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10700' }]
});

const buildDispatch = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Verification Dispatch', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/build-dispatch__ } },
  output: [{ bug: { key: 'PROJ-131' }, plan: { build: 'x', regression_test_exists: true }, dispatch_id: 'VERIFY-PROJ-131-1-1', ref: 'main', grep: '@checkout-coupon', repeat_each: '10', projects: 'chromium,firefox,webkit', polls: 0 }]
});

const recordVerify = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Register Verification',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $json.bug.key }}'), branch: expr('{{ $json.ref }}'), pr_url: '', run_id: '', status: 'ci_dispatched',
          kind: 'verification', dispatch_id: expr('{{ $json.dispatch_id }}'), module: expr('{{ $json.plan.module }}')
        },
        __DT_SCHEMA__
      }
    }
  },
  output: [{ id: 7 }]
});

const dispatchVerify = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Dispatch qa-pr.yml (repeat-each 10)',
    __HTTP_RETRY__
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/actions/workflows/qa-pr.yml/dispatches'),
      __GH_AUTH__
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ ref: $("Build Verification Dispatch").last().json.ref, inputs: { ticket: $("Build Verification Dispatch").last().json.bug.key, branch: $("Build Verification Dispatch").last().json.ref, grep: $("Build Verification Dispatch").last().json.grep, repeat_each: $("Build Verification Dispatch").last().json.repeat_each, projects: $("Build Verification Dispatch").last().json.projects, dispatch_id: $("Build Verification Dispatch").last().json.dispatch_id } }) }}')
    },
    __GH_CRED__
  },
  output: [{}]
});

const passContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Carry Dispatch Context', parameters: { mode: 'runOnceForAllItems', jsCode: 'return [{ json: $("Build Verification Dispatch").last().json }];' } },
  output: [{ dispatch_id: 'VERIFY-PROJ-131-1-1', polls: 0 }]
});

const waitResult = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: { name: 'Wait for WF2 Result', parameters: { resume: 'timeInterval', amount: 5, unit: 'minutes' } },
  output: [{ dispatch_id: 'VERIFY-PROJ-131-1-1', polls: 0 }]
});

const getRow = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Read Verification Row',
    alwaysOutputData: true,
    parameters: {
      resource: 'row', operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.dispatch_id }}') }] }
    }
  },
  output: [{ id: 7, status: 'passed', run_id: '11900000001', conclusion: 'success' }]
});

const checkResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Check Result', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/check-result__ } },
  output: [{ outcome: 'pass', polls: 1, run_id: '11900000001', run_url: 'https://github.com/acme/webapp/actions/runs/11900000001' }]
});

const routeOutcome = switchCase({
  version: 3.4,
  config: {
    name: 'Route Outcome',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'pass', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.outcome }}'), rightValue: 'pass', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'fail', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.outcome }}'), rightValue: 'fail', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'pending (poll again)', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.outcome }}'), rightValue: 'pending', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } }
        ]
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'timeout' }
    }
  }
});

const decide = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Verification Decision', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/decide__ } },
  output: [{ bug: { key: 'PROJ-131' }, verdict: 'PASS', target_statuses: ['Verified'], sheet_status: 'Verified', verified_date: '2026-10-17', comment: 'Verification — PASS', run_url: 'https://github.com/acme/webapp/actions/runs/1', plan: { build: 'x' } }]
});

const commentVerdict = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Comment Verification Result',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issueComment', operation: 'add',
      issueKey: expr('{{ $json.bug.key }}'),
      comment: expr('{{ $json.comment }}')
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10701' }]
});

const getTransitions = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Get Transitions',
    __HTTP_RETRY__
    parameters: {
      method: 'GET',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/2/issue/{{ $("Verification Decision").last().json.bug.key }}/transitions'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ transitions: [{ id: '41', name: 'Verify', to: { name: 'Verified' } }, { id: '51', name: 'Reopen', to: { name: 'Reopened' } }] }]
});

const pickTransition = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick Transition (never Closed)', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf3/pick-transition__ } },
  output: [{ bug: { key: 'PROJ-131' }, transition_id: '41', transition_name: 'Verify', sheet_status: 'Verified' }]
});

const doTransition = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Transition Bug',
    __HTTP_RETRY__
    parameters: {
      method: 'POST',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/2/issue/{{ $json.bug.key }}/transitions'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ transition: { id: $json.transition_id } }) }}'),
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{}]
});

const sheetUpdate = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Bug Sheet · Update Row',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet', operation: 'appendOrUpdate', authentication: 'oAuth2',
      documentId: { __rl: true, mode: 'id', value: expr('{{ $("Config").first().json.BUG_SHEET_ID }}') },
      sheetName: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.BUG_SHEET_TAB }}') },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['Jira Key'],
        value: {
          'Jira Key': expr('{{ $("Pick Transition (never Closed)").last().json.bug.key }}'),
          'Status': expr('{{ $("Pick Transition (never Closed)").last().json.sheet_status }}'),
          'Verified Date': expr('{{ $("Pick Transition (never Closed)").last().json.verified_date }}'),
          'Verified By': expr('{{ $("Pick Transition (never Closed)").last().json.verdict === "PASS" ? "QA Automation (n8n) — awaiting human QA sign-off" : "" }}'),
          'Build': expr('{{ $("Pick Transition (never Closed)").last().json.plan.build }}'),
          'Regression Test ID': expr('{{ $("Pick Transition (never Closed)").last().json.plan.regression_test_hint || "" }}'),
          'CI Run': expr('{{ $("Pick Transition (never Closed)").last().json.run_url }}')
        },
        schema: [
          { id: 'Jira Key', displayName: 'Jira Key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'Status', displayName: 'Status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Verified Date', displayName: 'Verified Date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Verified By', displayName: 'Verified By', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Build', displayName: 'Build', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Regression Test ID', displayName: 'Regression Test ID', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'CI Run', displayName: 'CI Run', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
        ]
      },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets (BUG_SHEET_ID)') }
  },
  output: [{}]
});

const slackTimeout = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · Verification Timed Out',
    parameters: {
      resource: 'message', operation: 'post', authentication: 'accessToken', select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      messageType: 'text',
      text: expr(':hourglass: *Fix verification timed out* for {{ $json.bug.key }} after {{ $json.polls * 5 }} min (dispatch {{ $json.dispatch_id }}). Status stays *Fixed*; it will be retried tomorrow. Check that WF2 is active and the GitHub webhook delivers workflow_run events.')
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ ok: true }]
});

const nextBug = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'Next Bug' }, output: [{}] });

const note = sticky('## QA | Fix Verification (WF3)\nSOP stage: **Verify**. Daily 10:00 Asia/Karachi (workflow timezone) + manual.\nJira bugs in **Fixed** → comments, PR links, Bug Sheet row → Fix Verification agent (t=0) plans grep `@<module>`.\nNot deployed → comment NOT READY, stays Fixed.\nReady → register in qa_runs (kind=verification) → dispatch `qa-pr.yml` with `repeat_each=10` on chromium/firefox/webkit → poll qa_runs every 5 min (WF2 writes the result, max 90 min).\nPASS → comment + transition **Verified** (never Closed) · FAIL → comment with evidence + **Reopened** · then upsert the Bug Sheet row.', [], { color: 6 });

export default workflow('qa-fix-verification', 'QA | Fix Verification')
  .add(note)
  .add(manualRun)
  .to(config)
  .add(daily)
  .to(config)
  .add(config)
  .to(searchFixed)
  .to(normalizeBugs)
  .to(loopBugs.onEachBatch(
    currentBug
      .to(getComments)
      .to(getLinks)
      .to(sheetFind)
      .to(verifyContext)
      .to(verifyAgent)
      .to(validateVerify)
      .to(isReady
        .onTrue(buildDispatch.to(recordVerify).to(dispatchVerify).to(passContext).to(waitResult))
        .onFalse(commentBlocked.to(nextBug)))
  ))
  .add(waitResult)
  .to(getRow)
  .to(checkResult)
  .to(routeOutcome
    .onCase(0, decide)
    .onCase(1, decide)
    .onCase(2, waitResult)
    .onCase(3, slackTimeout.to(nextBug)))
  .add(decide)
  .to(commentVerdict)
  .to(getTransitions)
  .to(pickTransition)
  .to(doTransition)
  .to(sheetUpdate)
  .to(nextBug)
  .add(nextBug)
  .to(nextBatch(loopBugs));
