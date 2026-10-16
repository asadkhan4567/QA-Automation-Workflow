import { workflow, node, trigger, sticky, newCredential, ifElse, switchCase, languageModel, expr } from '@n8n/workflow-sdk';

const hook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'GitHub workflow_run Webhook',
    parameters: { httpMethod: 'POST', path: 'qa-ci-result', responseMode: 'onReceived', options: { rawBody: true, responseCode: { values: { responseCode: 200 } } } }
  },
  output: [{ headers: { 'x-github-event': 'workflow_run', 'x-hub-signature-256': 'sha256=abc' }, body: { action: 'completed' } }]
});

const config = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'c1', name: 'JIRA_PROJECT', value: '__CFG_JIRA_PROJECT__', type: 'string' },
          { id: 'c2', name: 'JIRA_BASE_URL', value: '__CFG_JIRA_BASE_URL__', type: 'string' },
          { id: 'c3', name: 'GITHUB_OWNER', value: '__CFG_GITHUB_OWNER__', type: 'string' },
          { id: 'c4', name: 'GITHUB_REPO', value: '__CFG_GITHUB_REPO__', type: 'string' },
          { id: 'c5', name: 'SLACK_CHANNEL', value: '__CFG_SLACK_CHANNEL__', type: 'string' },
          { id: 'c6', name: 'BUG_SHEET_ID', value: '__CFG_BUG_SHEET_ID__', type: 'string' },
          { id: 'c7', name: 'BUG_SHEET_TAB', value: 'Bugs', type: 'string' },
          { id: 'c8', name: 'GITHUB_WEBHOOK_SECRET', value: '__CFG_GITHUB_WEBHOOK_SECRET__', type: 'string' }
        ]
      },
      options: { includeBinary: true }
    }
  },
  output: [{ JIRA_PROJECT: 'PROJ', JIRA_BASE_URL: 'https://example.atlassian.net', GITHUB_OWNER: 'acme', GITHUB_REPO: 'webapp', SLACK_CHANNEL: 'qa-automation', BUG_SHEET_ID: 'sheet123', BUG_SHEET_TAB: 'Bugs' }]
});

const verify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Verify Signature & Filter', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/verify-signature__ } },
  output: [{ run_id: '11873402211', run_attempt: 1, conclusion: 'failure', run_url: 'https://github.com/acme/webapp/actions/runs/11873402211', artifacts_url: 'https://api.github.com/repos/acme/webapp/actions/runs/11873402211/artifacts', head_branch: 'qa/PROJ-101', head_sha: 'c0ffee1234', trigger_event: 'workflow_dispatch', display_title: 'qa-pr PROJ-101 [PROJ-101-616-1]', repo: 'acme/webapp', ticket: 'PROJ-101', dispatch_id: 'PROJ-101-616-1', row_key: 'PROJ-101-616-1', delivery: 'd1' }]
});

const lookupRow = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Find Run Row',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] }
    }
  },
  output: [{ id: 1, ticket: 'PROJ-101', kind: 'design', module: 'checkout-coupon', pr_url: 'https://github.com/acme/webapp/pull/87', branch: 'qa/PROJ-101' }]
});

const runContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Run Context', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/run-context__ } },
  output: [{ run_id: '11873402211', run_attempt: 1, conclusion: 'failure', run_url: 'https://github.com/acme/webapp/actions/runs/11873402211', artifacts_url: 'https://api.github.com/x', ticket: 'PROJ-101', row_key: 'PROJ-101-616-1', kind: 'design', module: 'checkout-coupon', pr_url: 'https://github.com/acme/webapp/pull/87', branch: 'qa/PROJ-101', head_sha: 'c0ffee1234' }]
});

const isVerification = ifElse({
  version: 2.3,
  config: {
    name: 'Fix-Verification Run?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.kind }}'), rightValue: 'verification', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and'
      }
    }
  }
});

const recordVerification = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Record Verification Result',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $json.run_id }}'),
          status: expr('{{ $json.conclusion === "success" ? "passed" : "failed" }}'),
          conclusion: expr('{{ $json.conclusion }}'),
          dispatch_id: expr('{{ $json.row_key }}')
        },
        __DT_SCHEMA__
      }
    }
  },
  output: [{ id: 3 }]
});

const routeConclusion = switchCase({
  version: 3.4,
  config: {
    name: 'Route by Conclusion',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'success', conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.conclusion }}'), rightValue: 'success', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'failure', conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ ["failure", "timed_out"].includes($json.conclusion) }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } }
        ]
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'cancelled/other' }
    }
  }
});

const ciPassed = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'CI Passed' },
  output: [{ run_id: '11873402211', conclusion: 'success', ticket: 'PROJ-101', row_key: 'PROJ-101-616-1' }]
});

const jiraPass = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Comment CI Passed',
    onError: 'continueRegularOutput',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issueComment', operation: 'add',
      issueKey: expr('{{ $json.ticket }}'),
      comment: expr('QA automation ✅ qa-pr passed for {{ $json.head_branch }} ({{ $json.head_sha.slice(0, 7) }}).\nRun: {{ $json.run_url }}\n{{ $json.pr_url ? "PR: " + $json.pr_url + " — ready for human review and merge." : "" }}')
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10500' }]
});

const slackPass = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · CI Passed',
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message', operation: 'post', authentication: 'accessToken', select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      messageType: 'text',
      text: expr(':white_check_mark: *qa-pr passed* — {{ $json.ticket || $json.head_branch }} · <{{ $json.run_url }}|run {{ $json.run_id }}>{{ $json.pr_url ? "\\nPR: " + $json.pr_url : "" }}\n*MERGE: ALLOW* (human approval still required)')
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ ok: true }]
});

const recordPass = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Record Passed',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $json.ticket }}'), branch: expr('{{ $json.branch }}'), pr_url: expr('{{ $json.pr_url }}'),
          run_id: expr('{{ $json.run_id }}'), status: 'passed', kind: expr('{{ $json.kind }}'), dispatch_id: expr('{{ $json.row_key }}'),
          conclusion: 'success', merge_decision: 'ALLOW', module: expr('{{ $json.module }}')
        },
        __DT_SCHEMA__
      }
    }
  },
  output: [{ id: 1 }]
});

const recordOther = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Record Cancelled/Other',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { run_id: expr('{{ $json.run_id }}'), status: expr('{{ $json.conclusion }}'), conclusion: expr('{{ $json.conclusion }}'), dispatch_id: expr('{{ $json.row_key }}') },
        __DT_SCHEMA__
      }
    }
  },
  output: [{ id: 1 }]
});

const listArtifacts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · List Run Artifacts',
    __HTTP_RETRY__
    parameters: {
      method: 'GET',
      url: expr('{{ $json.artifacts_url }}?per_page=100'),
      __GH_AUTH__
    },
    __GH_CRED__
  },
  output: [{ total_count: 2, artifacts: [{ name: 'results-json', archive_download_url: 'https://api.github.com/repos/acme/webapp/actions/artifacts/1/zip', expired: false, size_in_bytes: 4096 }] }]
});

const pickArtifact = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick results-json Artifact', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/pick-artifact__ } },
  output: [{ run_id: '11873402211', has_results: true, artifact_url: 'https://api.github.com/repos/acme/webapp/actions/artifacts/1/zip' }]
});

const hasResults = ifElse({
  version: 2.3,
  config: {
    name: 'Has results.json?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.has_results }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const downloadArtifact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Download results-json.zip',
    __HTTP_RETRY__
    parameters: {
      method: 'GET',
      url: expr('{{ $json.artifact_url }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      options: { timeout: 60000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } }
    },
    __GH_CRED__
  },
  output: [{}]
});

const parseResults = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Unzip & Parse results.json', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/parse-results__ } },
  output: [{ run_id: '11873402211', total: 18, failed: 2, failures: [{ title: 'TC-02 expired coupon', project: 'chromium', attempts: ['failed', 'failed', 'failed'], error: 'Expected: "This coupon has expired"' }] }]
});

const noResults = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'No results.json', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/no-results__ } },
  output: [{ run_id: '11873402211', total: 0, failed: 1, failures: [{ title: '(no results.json — job failed before tests ran)' }] }]
});

const triageInput = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Triage Input' },
  output: [{ run_id: '11873402211', total: 18, failed: 2, failures: [] }]
});

const openBugs = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Open Bugs (dedupe)',
    alwaysOutputData: true,
    executeOnce: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issue', operation: 'getAll', returnAll: false, limit: 50,
      options: {
        jql: expr('project = "{{ $("Config").first().json.JIRA_PROJECT }}" AND issuetype = Bug AND statusCategory != Done ORDER BY updated DESC'),
        fields: 'summary,labels,status,components'
      }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ key: 'PROJ-77', fields: { summary: 'Checkout total not refreshed after coupon removal', labels: ['qa-automation', 'checkout-coupon'] } }]
});

const triageModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Triage (t=0)',
    parameters: { model: { __rl: true, mode: 'id', value: '__MODEL_ID__' }, options: { temperature: 0, maxTokensToSample: 8000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const triageAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'CI Failure Triage Agent',
    executeOnce: true,
    parameters: {
      promptType: 'define',
      text: expr('Triage this failed qa-pr GitHub Actions run. Return STRICT JSON per the runtime contract.\n\nRUN:\n{{ JSON.stringify((({ run_id, run_attempt, run_url, conclusion, ticket, branch, head_sha, module, total, failed, stats, truncated }) => ({ run_id, run_attempt, run_url, conclusion, ticket, branch, head_sha, module, total, failed, stats, truncated }))($("Triage Input").last().json), null, 1) }}\n\nFAILED TESTS (attempts = per-retry statuses):\n{{ JSON.stringify($("Triage Input").last().json.failures, null, 1) }}\n\nOPEN JIRA BUGS (duplicate / known-issue check):\n{{ JSON.stringify($("Jira · Open Bugs (dedupe)").all().filter(i => i.json.key).map(i => ({ key: i.json.key, summary: i.json.fields?.summary, labels: i.json.fields?.labels })), null, 1) }}'),
      options: { systemMessage: __PROMPT:failure-triage__, maxIterations: 3 }
    },
    subnodes: { model: triageModel }
  },
  output: [{ output: '{"run_id":"11873402211","total":18,"failed":2,"merge_decision":"BLOCK","issues":[]}' }]
});

const validateTriage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Triage JSON', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/validate-triage__ } },
  output: [{ run_id: '11873402211', ticket: 'PROJ-101', merge_decision: 'BLOCK', agent_merge_decision: 'BLOCK', triage: { issues: [] }, failures: [] }]
});

const splitIssues = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'One Item per Issue', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/split-issues__ } },
  output: [{ idx: 1, route: 'product_bug', issue: { category: 'ProductBug', confidence: 0.86, tests: [{ title: 'TC-02' }] }, ticket: 'PROJ-101', run_url: 'https://github.com/acme/webapp/actions/runs/1', module: 'checkout-coupon', failures: [] }]
});

const routeIssue = switchCase({
  version: 3.4,
  config: {
    name: 'Route Issue',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'ProductBug', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), rightValue: 'product_bug', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Flaky / TestBug / TestData', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), rightValue: 'task', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Environment', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), rightValue: 'environment', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'KnownIssue', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), rightValue: 'known_issue', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } }
        ]
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Needs human review (conf < 0.7)' }
    }
  }
});

const bugModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Bug Report (t=0)',
    parameters: { model: { __rl: true, mode: 'id', value: '__MODEL_ID__' }, options: { temperature: 0, maxTokensToSample: 6000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const bugAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Bug Report Agent',
    parameters: {
      promptType: 'define',
      text: expr('Write the bug report for this triaged ProductBug. Return STRICT JSON per the runtime contract.\n\nTICKET UNDER TEST: {{ $json.ticket }}\nMODULE: {{ $json.module }}\nCI RUN: {{ $json.run_url }} (attempt {{ $json.run_attempt }})\nBUILD (commit): {{ $json.head_sha }}\nPR: {{ $json.pr_url || "n/a" }}\nTODAY (Asia/Karachi): {{ $now.setZone("Asia/Karachi").toFormat("yyyy-MM-dd") }}\n\nTRIAGE ISSUE:\n{{ JSON.stringify($json.issue, null, 1) }}\n\nFAILED TEST EVIDENCE:\n{{ JSON.stringify($json.failures, null, 1) }}'),
      options: { systemMessage: __PROMPT:bug-report__, maxIterations: 3 }
    },
    subnodes: { model: bugModel }
  },
  output: [{ output: '{"title":"[BUG] x"}' }]
});

const validateBug = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Bug JSON', parameters: { mode: 'runOnceForEachItem', jsCode: __CODE:wf2/validate-bug__ } },
  output: [{ ticket: 'PROJ-101', module: 'checkout-coupon', run_url: 'https://github.com/acme/webapp/actions/runs/1', head_sha: 'c0ffee1234', bug: { title: '[BUG] x', markdown: '# [BUG] x', severity: 'S2', priority: 'P1', sheet_row: {} }, jira_priority: 'High' }]
});

const createBug = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Create Bug',
    __HTTP_RETRY__
    parameters: {
      method: 'POST',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/2/issue'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ fields: { project: { key: $("Config").first().json.JIRA_PROJECT }, issuetype: { name: "Bug" }, summary: $json.bug.title.replace(/^\\[BUG\\]\\s*/, "").slice(0, 250), description: $json.bug.markdown + "\\n\\n----\\nSeverity: " + $json.bug.severity + " · Priority: " + $json.bug.priority + " (" + $json.jira_priority + ")\\nFiled by n8n QA | CI Result & Triage from " + $json.run_url, labels: ["qa-automation", "ci-triage", $json.module].filter(Boolean) } }) }}'),
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10601', key: 'PROJ-131', self: 'https://example.atlassian.net/rest/api/2/issue/10601' }]
});

const sheetRow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Bug Sheet Row', parameters: { mode: 'runOnceForEachItem', jsCode: __CODE:wf2/sheet-row__ } },
  output: [{ 'Bug ID': 'PROJ-131', 'Jira Key': 'PROJ-131', Title: '[BUG] x', Module: 'checkout-coupon', Severity: 'S2', Priority: 'P1', Status: 'Open' }]
});

const appendSheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Bug Sheet · Append Row',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'append',
      authentication: 'oAuth2',
      documentId: { __rl: true, mode: 'id', value: expr('{{ $("Config").first().json.BUG_SHEET_ID }}') },
      sheetName: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.BUG_SHEET_TAB }}') },
      columns: { mappingMode: 'autoMapInputData', value: {} },
      options: { handlingExtraData: 'ignoreIt' }
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets (BUG_SHEET_ID)') }
  },
  output: [{}]
});

const createTask = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Create Task (flaky / test-bug)',
    __HTTP_RETRY__
    parameters: {
      method: 'POST',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/2/issue'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ fields: { project: { key: $("Config").first().json.JIRA_PROJECT }, issuetype: { name: "Task" }, summary: ("[" + $json.issue.category + "] " + ($json.issue.tests[0]?.title || $json.issue.signature)).slice(0, 250), description: "CI run: " + $json.run_url + "\\nSource ticket: " + $json.ticket + "\\nConfidence: " + $json.issue.confidence + "\\n\\nEvidence: " + $json.issue.evidence + "\\n" + ($json.issue.hypothesis || "") + "\\n\\nAction: " + $json.issue.action + "\\nTests:\\n" + $json.issue.tests.map(t => "- " + t.title + " (" + (t.project || "") + ") " + (t.file || "")).join("\\n") + "\\n\\nSOP: Flaky → tag @flaky, quarantine from the gate, fix within 1 sprint. TestBug → fix spec (POM/selector) and re-run the review gate.", labels: ["qa-automation", { Flaky: "flaky", TestBug: "test-bug", TestData: "test-data" }[$json.issue.category], $json.module].filter(Boolean) } }) }}'),
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10602', key: 'PROJ-132' }]
});

const canRerun = ifElse({
  version: 2.3,
  config: {
    name: 'First Attempt? (re-run once)',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ Number($json.run_attempt) }}'), rightValue: 2, operator: { type: 'number', operation: 'lt' } }],
        combinator: 'and'
      }
    }
  }
});

const rerun = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Re-run Failed Jobs',
    executeOnce: true,
    __HTTP_RETRY__
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/actions/runs/{{ $json.run_id }}/rerun-failed-jobs'),
      __GH_AUTH__
    },
    __GH_CRED__
  },
  output: [{}]
});

const slackEnv = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · Env Failure Persists',
    executeOnce: true,
    parameters: {
      resource: 'message', operation: 'post', authentication: 'accessToken', select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      messageType: 'text',
      text: expr(':rotating_light: *Environment failure persists after re-run* — {{ $json.ticket }} · <{{ $json.run_url }}|run {{ $json.run_id }}> (attempt {{ $json.run_attempt }})\n{{ $json.issue.signature }}\nEscalate to DevOps (SOP Stage 5).')
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ ok: true }]
});

const commentKnown = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Link to Known Issue',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issueComment', operation: 'add',
      issueKey: expr('{{ $json.issue.known_issue_key }}'),
      comment: expr('Seen again by QA automation (no new bug filed): {{ $json.issue.tests.map(t => t.title).join("; ") }}\nCI run: {{ $json.run_url }} · source ticket {{ $json.ticket }}\nEvidence: {{ $json.issue.evidence }}')
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10603' }]
});

const slackReview = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · Needs Human Review',
    parameters: {
      resource: 'message', operation: 'post', authentication: 'accessToken', select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      messageType: 'text',
      text: expr(':mag: *Needs human review* — {{ $json.ticket }} · <{{ $json.run_url }}|run {{ $json.run_id }}>\nCategory guess: {{ $json.issue.category }} (confidence {{ $json.issue.confidence }})\nTests: {{ $json.issue.tests.map(t => t.title).join("; ") }}\nEvidence: {{ $json.issue.evidence }}\n{{ $json.issue.hypothesis || "" }}')
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ ok: true }]
});

const buildSummary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Triage Summary', parameters: { mode: 'runOnceForAllItems', jsCode: __CODE:wf2/slack-summary__ } },
  output: [{ slack_text: 'triage', merge_decision: 'BLOCK', ticket: 'PROJ-101', run_url: 'https://github.com/acme/webapp/actions/runs/1' }]
});

const slackSummary = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · Triage Summary',
    parameters: {
      resource: 'message', operation: 'post', authentication: 'accessToken', select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      messageType: 'text',
      text: expr('{{ $json.slack_text }}')
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ ok: true }]
});

const jiraTriage = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Comment Triage on Ticket',
    onError: 'continueRegularOutput',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud', resource: 'issueComment', operation: 'add',
      issueKey: expr('{{ $json.ticket }}'),
      comment: expr('QA automation ❌ qa-pr failed — MERGE: {{ $json.merge_decision }}\nRun: {{ $json.run_url }} (attempt {{ $json.run_attempt }})\n{{ $json.triage.issues.map((i, k) => (k + 1) + ". [" + i.category + " " + i.confidence + "] " + i.tests.map(t => t.title).join("; ") + " — " + i.action).join("\\n") }}')
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10604' }]
});

const recordFail = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Record Failed + Decision',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: '__DATA_TABLE_ID__', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $json.ticket }}'), branch: expr('{{ $json.branch }}'), pr_url: expr('{{ $json.pr_url }}'),
          run_id: expr('{{ $json.run_id }}'), status: 'failed', kind: expr('{{ $json.kind }}'), dispatch_id: expr('{{ $json.row_key }}'),
          conclusion: expr('{{ $json.conclusion }}'), merge_decision: expr('{{ $json.merge_decision }}'), module: expr('{{ $json.module }}')
        },
        __DT_SCHEMA__
      }
    }
  },
  output: [{ id: 1 }]
});

const note = sticky('## QA | CI Result & Triage (WF2)\nSOP stages: **Triage → Report**.\nGitHub repo webhook (event: *Workflow runs*, content type JSON, secret = Config.GITHUB_WEBHOOK_SECRET) → HMAC-SHA256 check of the raw body → only completed `qa-pr.yml` runs.\n- success → Jira ✅ comment, Slack ✅, qa_runs passed\n- failure → unzip `results-json` in a Code node → Triage agent → route: ProductBug → Bug Report agent → Jira Bug + Bug Sheet row · Flaky/TestBug/TestData → Jira Task · Environment → re-run once · conf < 0.7 → Slack review\n- Slack summary with MERGE BLOCK / ALLOW_AFTER_FIX / ALLOW. Fix-verification runs only update qa_runs (WF3 decides).', [], { color: 5 });

export default workflow('qa-ci-triage', 'QA | CI Result & Triage')
  .add(note)
  .add(hook)
  .to(config)
  .to(verify)
  .to(lookupRow)
  .to(runContext)
  .to(isVerification
    .onTrue(recordVerification)
    .onFalse(routeConclusion
      .onCase(0, ciPassed)
      .onCase(1, listArtifacts)
      .onCase(2, recordOther)))
  .add(ciPassed)
  .to(jiraPass)
  .add(ciPassed)
  .to(slackPass)
  .add(ciPassed)
  .to(recordPass)
  .add(listArtifacts)
  .to(pickArtifact)
  .to(hasResults
    .onTrue(downloadArtifact.to(parseResults).to(triageInput))
    .onFalse(noResults.to(triageInput)))
  .add(triageInput)
  .to(openBugs)
  .to(triageAgent)
  .to(validateTriage)
  .to(splitIssues)
  .to(routeIssue
    .onCase(0, bugAgent.to(validateBug).to(createBug).to(sheetRow).to(appendSheet))
    .onCase(1, createTask)
    .onCase(2, canRerun.onTrue(rerun).onFalse(slackEnv))
    .onCase(3, commentKnown)
    .onCase(4, slackReview))
  .add(validateTriage)
  .to(buildSummary)
  .to(slackSummary)
  .add(validateTriage)
  .to(jiraTriage)
  .add(validateTriage)
  .to(recordFail);
