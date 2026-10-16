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
          { id: 'c1', name: 'JIRA_PROJECT', value: '<SET_ME:JIRA_PROJECT>', type: 'string' },
          { id: 'c2', name: 'JIRA_BASE_URL', value: '<SET_ME:JIRA_BASE_URL>', type: 'string' },
          { id: 'c3', name: 'GITHUB_OWNER', value: '<SET_ME:GITHUB_OWNER>', type: 'string' },
          { id: 'c4', name: 'GITHUB_REPO', value: '<SET_ME:GITHUB_REPO>', type: 'string' },
          { id: 'c5', name: 'SLACK_CHANNEL', value: '<SET_ME:SLACK_CHANNEL>', type: 'string' },
          { id: 'c6', name: 'BUG_SHEET_ID', value: '<SET_ME:BUG_SHEET_ID>', type: 'string' },
          { id: 'c7', name: 'BUG_SHEET_TAB', value: 'Bugs', type: 'string' },
          { id: 'c8', name: 'GITHUB_WEBHOOK_SECRET', value: '<SET_ME:GITHUB_WEBHOOK_SECRET>', type: 'string' }
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
  config: { name: 'Verify Signature & Filter', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Verify GitHub's X-Hub-Signature-256 over the RAW request body, then keep only completed qa-pr.yml runs.\n" +
      "const crypto = require('crypto');\n" +
      "const cfg = $('Config').first().json;\n" +
      "const item = $input.first();\n" +
      "const headers = item.json.headers || {};\n" +
      "const secret = String(cfg.GITHUB_WEBHOOK_SECRET || '');\n" +
      "if (!secret || secret.startsWith('<SET_ME')) throw new Error('GITHUB_WEBHOOK_SECRET is not configured in Config');\n" +
      "if (!item.binary || !item.binary.data) throw new Error('Raw body missing \u2014 enable the Webhook option \"Raw Body\"');\n" +
      "const raw = await this.helpers.getBinaryDataBuffer(0, 'data');\n" +
      "const enc = new TextEncoder();\n" +
      "const expected = enc.encode('sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'));\n" +
      "const got = enc.encode(String(headers['x-hub-signature-256'] || ''));\n" +
      "if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {\n" +
      "  throw new Error(`Invalid X-Hub-Signature-256 (delivery ${headers['x-github-delivery'] || 'n/a'}) \u2014 request rejected`);\n" +
      "}\n" +
      "const body = JSON.parse(new TextDecoder().decode(raw));\n" +
      "const event = headers['x-github-event'];\n" +
      "const run = body.workflow_run;\n" +
      "const path = String(body.workflow?.path || run?.path || '');\n" +
      "if (event !== 'workflow_run' || body.action !== 'completed' || !run || !/qa-pr\\.ya?ml$/.test(path)) return [];\n" +
      "const title = String(run.display_title || run.name || '');\n" +
      "const m = title.match(/qa-pr\\s+([A-Z][A-Z0-9]+-\\d+)\\s+\\[([^\\]]+)\\]/);\n" +
      "const branchKey = String(run.head_branch || '').match(/^qa\\/([A-Z][A-Z0-9]+-\\d+)$/);\n" +
      "const ticket = m ? m[1] : branchKey ? branchKey[1] : '';\n" +
      "const dispatch_id = m ? m[2] : '';\n" +
      "return [{\n" +
      "  json: {\n" +
      "    run_id: String(run.id),\n" +
      "    run_attempt: run.run_attempt || 1,\n" +
      "    conclusion: run.conclusion,\n" +
      "    run_url: run.html_url,\n" +
      "    artifacts_url: run.artifacts_url,\n" +
      "    head_branch: run.head_branch,\n" +
      "    head_sha: run.head_sha,\n" +
      "    trigger_event: run.event,\n" +
      "    display_title: title,\n" +
      "    repo: body.repository?.full_name || `${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}`,\n" +
      "    ticket,\n" +
      "    dispatch_id,\n" +
      "    row_key: dispatch_id || `run-${run.id}`,\n" +
      "    delivery: headers['x-github-delivery'] || '',\n" +
      "  },\n" +
      "}];\n") } },
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
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] }
    }
  },
  output: [{ id: 1, ticket: 'PROJ-101', kind: 'design', module: 'checkout-coupon', pr_url: 'https://github.com/acme/webapp/pull/87', branch: 'qa/PROJ-101' }]
});

const runContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Run Context', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Merge the verified run with its qa_runs row (absent for manual / pull_request runs).\n" +
      "const run = $('Verify Signature & Filter').first().json;\n" +
      "const row = $input.all().map((i) => i.json).find((r) => r && r.id !== undefined) || {};\n" +
      "return [{ json: { ...run, kind: row.kind || 'pr', module: row.module || '', pr_url: row.pr_url || '', branch: row.branch || run.head_branch, qa_row_found: !!row.id } }];\n") } },
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
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
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
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
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
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $json.ticket }}'), branch: expr('{{ $json.branch }}'), pr_url: expr('{{ $json.pr_url }}'),
          run_id: expr('{{ $json.run_id }}'), status: 'passed', kind: expr('{{ $json.kind }}'), dispatch_id: expr('{{ $json.row_key }}'),
          conclusion: 'success', merge_decision: 'ALLOW', module: expr('{{ $json.module }}')
        },
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
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
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { run_id: expr('{{ $json.run_id }}'), status: expr('{{ $json.conclusion }}'), conclusion: expr('{{ $json.conclusion }}'), dispatch_id: expr('{{ $json.row_key }}') },
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.artifacts_url }}?per_page=100'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ total_count: 2, artifacts: [{ name: 'results-json', archive_download_url: 'https://api.github.com/repos/acme/webapp/actions/artifacts/1/zip', expired: false, size_in_bytes: 4096 }] }]
});

const pickArtifact = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick results-json Artifact', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $('Run Context').first().json;\n" +
      "const arts = $input.first().json.artifacts || [];\n" +
      "const a = arts.find((x) => x.name === 'results-json' && !x.expired);\n" +
      "return [{ json: { ...ctx, has_results: !!a, artifact_url: a ? a.archive_download_url : '', artifact_size: a ? a.size_in_bytes : 0 } }];\n") } },
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.artifact_url }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      options: { timeout: 60000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } }
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{}]
});

const parseResults = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Unzip & Parse results.json', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Minimal ZIP reader + RFC1951 inflate in pure JS (n8n Cloud blocks the zlib module in Code nodes).\n" +
      "function inflateRaw(src) {\n" +
      "  const out = []; let pos = 0, bitBuf = 0, bitCnt = 0;\n" +
      "  const bits = (n) => { while (bitCnt < n) { if (pos >= src.length) throw new Error('inflate: unexpected end'); bitBuf |= src[pos++] << bitCnt; bitCnt += 8; } const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v; };\n" +
      "  const build = (lens) => { const count = new Array(16).fill(0); lens.forEach((l) => count[l]++); count[0] = 0; const offs = [0]; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1]; const sym = []; lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; }); return { count, sym }; };\n" +
      "  const decode = (h) => { let code = 0, first = 0, idx = 0; for (let len = 1; len < 16; len++) { code |= bits(1); const c = h.count[len]; if (code - c < first) return h.sym[idx + (code - first)]; idx += c; first += c; first <<= 1; code <<= 1; } throw new Error('inflate: bad code'); };\n" +
      "  const LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258], LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];\n" +
      "  const DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577], DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];\n" +
      "  let fixedL, fixedD;\n" +
      "  let final = 0;\n" +
      "  while (!final) {\n" +
      "    final = bits(1); const type = bits(2);\n" +
      "    if (type === 0) {\n" +
      "      bitBuf = 0; bitCnt = 0; const len = src[pos] | (src[pos + 1] << 8); pos += 4;\n" +
      "      for (let i = 0; i < len; i++) out.push(src[pos++]);\n" +
      "      continue;\n" +
      "    }\n" +
      "    let lit, dist;\n" +
      "    if (type === 1) {\n" +
      "      if (!fixedL) { const l = []; for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8; fixedL = build(l); fixedD = build(new Array(30).fill(5)); }\n" +
      "      lit = fixedL; dist = fixedD;\n" +
      "    } else if (type === 2) {\n" +
      "      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;\n" +
      "      const ord = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]; const cl = new Array(19).fill(0);\n" +
      "      for (let i = 0; i < hclen; i++) cl[ord[i]] = bits(3);\n" +
      "      const ch = build(cl); const lens = [];\n" +
      "      while (lens.length < hlit + hdist) {\n" +
      "        const s = decode(ch);\n" +
      "        if (s < 16) lens.push(s);\n" +
      "        else if (s === 16) { const prev = lens[lens.length - 1]; for (let r = 3 + bits(2); r > 0; r--) lens.push(prev); }\n" +
      "        else if (s === 17) { for (let r = 3 + bits(3); r > 0; r--) lens.push(0); }\n" +
      "        else { for (let r = 11 + bits(7); r > 0; r--) lens.push(0); }\n" +
      "      }\n" +
      "      lit = build(lens.slice(0, hlit)); dist = build(lens.slice(hlit));\n" +
      "    } else throw new Error('inflate: bad block type');\n" +
      "    for (;;) {\n" +
      "      const s = decode(lit);\n" +
      "      if (s < 256) out.push(s);\n" +
      "      else if (s === 256) break;\n" +
      "      else { const i = s - 257; const len = LB[i] + bits(LE[i]); const d = decode(dist); const off = DB[d] + bits(DE[d]); const start = out.length - off; for (let k = 0; k < len; k++) out.push(out[start + k]); }\n" +
      "    }\n" +
      "  }\n" +
      "  return Uint8Array.from(out);\n" +
      "}\n" +
      "function unzip(buf) {\n" +
      "  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);\n" +
      "  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);\n" +
      "  let eocd = -1;\n" +
      "  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }\n" +
      "  if (eocd < 0) throw new Error('unzip: not a zip archive');\n" +
      "  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};\n" +
      "  for (let k = 0; k < n; k++) {\n" +
      "    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('unzip: bad central directory');\n" +
      "    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);\n" +
      "    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);\n" +
      "    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));\n" +
      "    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);\n" +
      "    const raw = u8.subarray(dataStart, dataStart + csize);\n" +
      "    if (method === 0) files[name] = raw; else if (method === 8) files[name] = inflateRaw(raw); else throw new Error(`unzip: method ${method} unsupported`);\n" +
      "    p += 46 + nlen + xlen + clen;\n" +
      "  }\n" +
      "  return files;\n" +
      "}\n" +
      "\n" +
      "// Unzip the results-json artifact and flatten Playwright JSON-reporter output into failures.\n" +
      "const ctx = $('Pick results-json Artifact').first().json;\n" +
      "const buf = await this.helpers.getBinaryDataBuffer(0, 'data');\n" +
      "const files = unzip(buf);\n" +
      "const name = Object.keys(files).find((n) => /results\\.json$/.test(n));\n" +
      "if (!name) throw new Error(`results.json not found in artifact (entries: ${Object.keys(files).join(', ')})`);\n" +
      "const report = JSON.parse(new TextDecoder().decode(files[name]));\n" +
      "const failures = [];\n" +
      "let total = 0;\n" +
      "const strip = (s) => String(s || '').replace(/\\u001b\\[[0-9;]*m/g, '');\n" +
      "const walk = (suite, filePath) => {\n" +
      "  const file = suite.file || filePath;\n" +
      "  for (const spec of suite.specs || []) {\n" +
      "    for (const t of spec.tests || []) {\n" +
      "      total += 1;\n" +
      "      const statuses = (t.results || []).map((r) => r.status);\n" +
      "      if (t.status === 'expected' || t.status === 'skipped') continue;\n" +
      "      const results = t.results || [];\n" +
      "      const last = results.slice(-1)[0] || {};\n" +
      "      const failedRun = [...results].reverse().find((r) => r.status !== 'passed') || last;\n" +
      "      const err = (failedRun.errors && failedRun.errors[0]) || failedRun.error || {};\n" +
      "      failures.push({\n" +
      "        title: spec.title,\n" +
      "        file: `${file}:${spec.line || ''}`,\n" +
      "        project: t.projectName,\n" +
      "        outcome: t.status,\n" +
      "        attempts: statuses,\n" +
      "        passed_on_retry: t.status === 'flaky',\n" +
      "        failed_all_retries: statuses.length > 0 && statuses.every((s) => s !== 'passed'),\n" +
      "        error: strip(err.message).slice(0, 1500),\n" +
      "        location: err.location ? `${err.location.file}:${err.location.line}` : '',\n" +
      "        duration_ms: (t.results || []).reduce((a, r) => a + (r.duration || 0), 0),\n" +
      "        attachments: (failedRun.attachments || []).map((x) => x.name),\n" +
      "      });\n" +
      "    }\n" +
      "  }\n" +
      "  for (const s of suite.suites || []) walk(s, file);\n" +
      "};\n" +
      "for (const s of report.suites || []) walk(s, s.file);\n" +
      "const stats = report.stats || {};\n" +
      "return [{ json: { ...ctx, total, failed: failures.length, stats, failures: failures.slice(0, 60), truncated: failures.length > 60 } }];\n") } },
  output: [{ run_id: '11873402211', total: 18, failed: 2, failures: [{ title: 'TC-02 expired coupon', project: 'chromium', attempts: ['failed', 'failed', 'failed'], error: 'Expected: "This coupon has expired"' }] }]
});

const noResults = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'No results.json', parameters: { mode: 'runOnceForAllItems', jsCode: ("// The job failed before Playwright wrote results.json (install, checkout, runner, secrets...).\n" +
      "const ctx = $('Pick results-json Artifact').first().json;\n" +
      "return [{ json: { ...ctx, total: 0, failed: 1, stats: {}, truncated: false, failures: [{ title: '(no results.json \u2014 job failed before tests ran)', file: '', project: '', outcome: 'unexpected', attempts: [], passed_on_retry: false, failed_all_retries: true, error: `No results-json artifact on run ${ctx.run_id}. See ${ctx.run_url}`, location: '', duration_ms: 0, attachments: [] }] } }];\n") } },
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
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0, maxTokensToSample: 8000 } },
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
      options: { systemMessage: ("<!-- Source skill: failure-triage (SKILL.md body, verbatim) + n8n runtime contract appended below. -->\n" +
      "\n" +
      "\n" +
      "# Failure Triage (SOP Stage 5 \u2014 Triage)\n" +
      "\n" +
      "## Input (any of)\n" +
      "- GitHub Actions run URL or ID\n" +
      "- `results/results.json` / `junit.xml`\n" +
      "- Trace zip, logs, screenshots, or pasted error output\n" +
      "\n" +
      "## Step 1 \u2014 Collect\n" +
      "- `gh run view <id> --log-failed`\n" +
      "- `gh run download <id>` \u2192 read results.json, traces, screenshots\n" +
      "- Per failed test capture: spec, test title, project/browser, error message, failing line, retry outcome, duration.\n" +
      "\n" +
      "## Step 2 \u2014 Group\n" +
      "Normalize the error signature (strip IDs, timestamps, numbers). Same signature = one issue.\n" +
      "\n" +
      "## Step 3 \u2014 Classify each issue\n" +
      "| Category | Signals |\n" +
      "|---|---|\n" +
      "| Product Bug | Assertion fails with wrong value/state; reproducible; fails on all retries; matches spec violation |\n" +
      "| Test Bug | Locator not found after a UI change; wrong expectation vs current spec; bad test data setup; test-order dependence |\n" +
      "| Flaky | Passed on retry; timing-related; fails intermittently across runs |\n" +
      "| Environment | 5xx, DNS/network errors, ECONNREFUSED, auth/secret missing, browser install failure, timeouts across many unrelated tests |\n" +
      "| Test Data | Seed missing, record already exists, data drift |\n" +
      "| Known Issue | Matches an open Jira bug (search before concluding) |\n" +
      "\n" +
      "Give each a confidence score 0\u20131. If < 0.7 \u2192 mark `NEEDS HUMAN REVIEW`. Never label a failure Flaky if it failed on every retry.\n" +
      "\n" +
      "## Step 4 \u2014 Check for duplicates\n" +
      "Search Jira (JQL) by module + error keywords: `project = <KEY> AND type = Bug AND statusCategory != Done AND text ~ \"<keyword>\"`.\n" +
      "\n" +
      "## Step 5 \u2014 Route\n" +
      "| Category | Action |\n" +
      "|---|---|\n" +
      "| Product Bug | Hand to `bug-report-writer` \u2192 Standard Bug Sheet + Jira |\n" +
      "| Test Bug | Fix spec (POM/selector), then `code-review` gate |\n" +
      "| Flaky | Tag `@flaky`, quarantine from gate, open a ticket, fix within 1 sprint |\n" +
      "| Environment | Rerun once; if still failing, escalate to DevOps |\n" +
      "| Test Data | Fix seed/fixture; rerun |\n" +
      "| Known Issue | Link to existing Jira; no new bug |\n" +
      "\n" +
      "## Step 6 \u2014 Merge decision\n" +
      "- BLOCK: any Product Bug, any S1/S2, or anything NEEDS HUMAN REVIEW\n" +
      "- ALLOW AFTER FIX: Test Bug / Test Data only after fix + green rerun\n" +
      "- ALLOW: Environment only after green rerun\n" +
      "\n" +
      "## Output format\n" +
      "```\n" +
      "Run: <id/url> | Total: X | Failed: Y | Unique issues: Z\n" +
      "MERGE: BLOCK / ALLOW AFTER FIX / ALLOW\n" +
      "\n" +
      "| # | Test | Browser | Category | Confidence | Evidence | Action | Jira |\n" +
      "|---|------|---------|----------|------------|----------|--------|------|\n" +
      "\n" +
      "Next steps:\n" +
      "- ...\n" +
      "```\n" +
      "\n" +
      "## Rules\n" +
      "- Evidence for every classification: error line, trace step, or retry result.\n" +
      "- Root cause stays a hypothesis unless confirmed (prefix `Hypothesis:`).\n" +
      "- QA owns the final call; this skill drafts the triage.\n" +
      "\n" +
      "---\n" +
      "\n" +
      "# n8n Runtime Contract \u2014 Agent: CI Failure Triage (overrides anything above that conflicts)\n" +
      "\n" +
      "Runs in WF2 after a failed `qa-pr` GitHub Actions run. Input: parsed `results.json` failures (spec, title, project, error, retries, status per attempt), run metadata, and open Jira bugs for duplicate checking. You cannot run `gh` \u2014 all evidence is in the input.\n" +
      "\n" +
      "- Group by normalized error signature. Classify each group. Never label Flaky if it failed on every retry.\n" +
      "- Confidence < 0.7 is allowed \u2014 the workflow routes it to human review automatically. Do not inflate confidence.\n" +
      "- Prefix unconfirmed root causes with `Hypothesis:`.\n" +
      "- `known_issue_key` = an existing Jira key from the input if the failure matches it, else null.\n" +
      "\n" +
      "## Output \u2014 STRICT JSON ONLY\n" +
      "```json\n" +
      "{\n" +
      "  \"run_id\": \"123456\",\n" +
      "  \"total\": 40,\n" +
      "  \"failed\": 3,\n" +
      "  \"merge_decision\": \"BLOCK\",\n" +
      "  \"issues\": [\n" +
      "    {\n" +
      "      \"signature\": \"expect(locator).toHaveText: expected 'Paid' got 'Pending'\",\n" +
      "      \"category\": \"ProductBug\",\n" +
      "      \"confidence\": 0.86,\n" +
      "      \"module\": \"checkout\",\n" +
      "      \"tests\": [{ \"title\": \"TC-03 ... @PROJ-123\", \"file\": \"tests/e2e/proj-123/checkout.spec.ts\", \"project\": \"chromium\" }],\n" +
      "      \"evidence\": \"failed 3/3 attempts; error line ...\",\n" +
      "      \"hypothesis\": \"Hypothesis: ...\",\n" +
      "      \"action\": \"File bug via bug-report-writer\",\n" +
      "      \"known_issue_key\": null\n" +
      "    }\n" +
      "  ]\n" +
      "}\n" +
      "```\n" +
      "Allowed `category`: ProductBug|TestBug|Flaky|Environment|TestData|KnownIssue. Allowed `merge_decision`: BLOCK|ALLOW_AFTER_FIX|ALLOW. `confidence` is a number 0\u20131.\n"), maxIterations: 3 }
    },
    subnodes: { model: triageModel }
  },
  output: [{ output: '{"run_id":"11873402211","total":18,"failed":2,"merge_decision":"BLOCK","issues":[]}' }]
});

const validateTriage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Triage JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
      "function parseAgentJson(raw, label) {\n" +
      "  if (raw && typeof raw === 'object') return raw;\n" +
      "  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`[${label}] empty/non-string agent output`);\n" +
      "  let s = raw.trim();\n" +
      "  const m = s.match(/^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/i);\n" +
      "  if (m) s = m[1].trim();\n" +
      "  try { return JSON.parse(s); } catch (e) { throw new Error(`[${label}] invalid JSON (${e.message}): ${s.slice(0, 300)}`); }\n" +
      "}\n" +
      "// schema: {type:'object'|'array'|'string'|'number'|'boolean'|'any', required, props, items, minItems, enum, pattern, minLength, min, max, nullable}\n" +
      "function checkSchema(v, s, p, e) {\n" +
      "  if (v === null || v === undefined) { if (!(s.nullable && v === null)) e.push(`${p} is ${v === null ? 'null' : 'missing'}`); return; }\n" +
      "  const t = s.type;\n" +
      "  if (t === 'any') return;\n" +
      "  if (t === 'object') {\n" +
      "    if (typeof v !== 'object' || Array.isArray(v)) return void e.push(`${p} must be an object`);\n" +
      "    (s.required || []).forEach((k) => { if (!(k in v)) e.push(`${p}.${k} is required`); });\n" +
      "    Object.entries(s.props || {}).forEach(([k, sub]) => { if (k in v) checkSchema(v[k], sub, `${p}.${k}`, e); });\n" +
      "  } else if (t === 'array') {\n" +
      "    if (!Array.isArray(v)) return void e.push(`${p} must be an array`);\n" +
      "    if (s.minItems && v.length < s.minItems) e.push(`${p} needs >= ${s.minItems} items`);\n" +
      "    if (s.items) v.forEach((x, i) => checkSchema(x, s.items, `${p}[${i}]`, e));\n" +
      "  } else if (t === 'string') {\n" +
      "    if (typeof v !== 'string') return void e.push(`${p} must be a string`);\n" +
      "    if (s.minLength && v.length < s.minLength) e.push(`${p} too short`);\n" +
      "    if (s.enum && !s.enum.includes(v)) e.push(`${p} must be one of ${s.enum.join('|')} (got \"${v}\")`);\n" +
      "    if (s.pattern && !new RegExp(s.pattern).test(v)) e.push(`${p} must match /${s.pattern}/`);\n" +
      "  } else if (t === 'number') {\n" +
      "    if (typeof v !== 'number' || Number.isNaN(v)) return void e.push(`${p} must be a number`);\n" +
      "    if (s.min !== undefined && v < s.min) e.push(`${p} must be >= ${s.min}`);\n" +
      "    if (s.max !== undefined && v > s.max) e.push(`${p} must be <= ${s.max}`);\n" +
      "  } else if (t === 'boolean') { if (typeof v !== 'boolean') e.push(`${p} must be a boolean`); }\n" +
      "  else e.push(`${p}: unknown schema type ${t}`);\n" +
      "}\n" +
      "function assertSchema(v, s, label) {\n" +
      "  const e = []; checkSchema(v, s, '$', e);\n" +
      "  if (e.length) throw new Error(`[${label}] schema mismatch (${e.length}): ${e.slice(0, 12).join('; ')}`);\n" +
      "  return v;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ctx = $('Triage Input').last().json;\n" +
      "const triage = parseAgentJson($input.first().json.output, 'Triage');\n" +
      "const CATS = ['ProductBug', 'TestBug', 'Flaky', 'Environment', 'TestData', 'KnownIssue'];\n" +
      "assertSchema(triage, {\n" +
      "  type: 'object', required: ['run_id', 'total', 'failed', 'merge_decision', 'issues'],\n" +
      "  props: {\n" +
      "    merge_decision: { type: 'string', enum: ['BLOCK', 'ALLOW_AFTER_FIX', 'ALLOW'] },\n" +
      "    total: { type: 'number', min: 0 }, failed: { type: 'number', min: 0 },\n" +
      "    issues: {\n" +
      "      type: 'array', minItems: 1,\n" +
      "      items: {\n" +
      "        type: 'object', required: ['signature', 'category', 'confidence', 'tests', 'evidence', 'action'],\n" +
      "        props: {\n" +
      "          category: { type: 'string', enum: CATS },\n" +
      "          confidence: { type: 'number', min: 0, max: 1 },\n" +
      "          tests: { type: 'array', minItems: 1, items: { type: 'object', required: ['title'] } },\n" +
      "          evidence: { type: 'string', minLength: 1 },\n" +
      "          known_issue_key: { type: 'string', nullable: true },\n" +
      "        },\n" +
      "      },\n" +
      "    },\n" +
      "  },\n" +
      "}, 'Triage');\n" +
      "// Skill rule: never Flaky if it failed on every retry.\n" +
      "for (const iss of triage.issues) {\n" +
      "  if (iss.category === 'Flaky') {\n" +
      "    const hits = ctx.failures.filter((f) => iss.tests.some((t) => t.title === f.title));\n" +
      "    if (hits.length && hits.every((f) => f.failed_all_retries)) { iss.category = 'TestBug'; iss.confidence = Math.min(iss.confidence, 0.6); iss.evidence += ' [auto-corrected: failed on every retry, cannot be Flaky]'; }\n" +
      "  }\n" +
      "  iss.route = iss.confidence < 0.7 ? 'review'\n" +
      "    : iss.category === 'ProductBug' ? 'product_bug'\n" +
      "    : ['Flaky', 'TestBug', 'TestData'].includes(iss.category) ? 'task'\n" +
      "    : iss.category === 'Environment' ? 'environment'\n" +
      "    : iss.category === 'KnownIssue' && iss.known_issue_key ? 'known_issue' : 'review';\n" +
      "}\n" +
      "// Deterministic merge decision (SOP Stage 5, step 6) \u2014 the agent's value is kept for audit.\n" +
      "const routes = triage.issues.map((i) => i.route);\n" +
      "const merge = routes.some((r) => ['product_bug', 'review', 'known_issue'].includes(r)) ? 'BLOCK'\n" +
      "  : routes.some((r) => r === 'task') ? 'ALLOW_AFTER_FIX'\n" +
      "  : 'ALLOW';\n" +
      "return [{ json: { ...ctx, triage, merge_decision: merge, agent_merge_decision: triage.merge_decision } }];\n") } },
  output: [{ run_id: '11873402211', ticket: 'PROJ-101', merge_decision: 'BLOCK', agent_merge_decision: 'BLOCK', triage: { issues: [] }, failures: [] }]
});

const splitIssues = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'One Item per Issue', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $input.first().json;\n" +
      "return ctx.triage.issues.map((issue, idx) => ({\n" +
      "  json: {\n" +
      "    idx: idx + 1, issue, route: issue.route,\n" +
      "    ticket: ctx.ticket, run_id: ctx.run_id, run_url: ctx.run_url, run_attempt: ctx.run_attempt,\n" +
      "    head_sha: ctx.head_sha, branch: ctx.branch, module: issue.module || ctx.module, pr_url: ctx.pr_url,\n" +
      "    failures: ctx.failures.filter((f) => issue.tests.some((t) => t.title === f.title)),\n" +
      "  },\n" +
      "}));\n") } },
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
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0, maxTokensToSample: 6000 } },
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
      options: { systemMessage: ("<!-- Source skill: asadullahkhan-bug-report-writer (SKILL.md body, verbatim) + n8n runtime contract appended below. -->\n" +
      "\n" +
      "\n" +
      "# Bug Report Writer\n" +
      "\n" +
      "Bad bug reports waste engineering time. Good ones get bugs fixed fast. This skill produces the latter.\n" +
      "\n" +
      "## Required structure \u2014 always use this template\n" +
      "\n" +
      "```markdown\n" +
      "# [BUG] <Concise one-line summary \u2014 what's broken, where>\n" +
      "\n" +
      "## Summary\n" +
      "<2-3 sentences. What is broken, under what conditions, and what's the user impact.>\n" +
      "\n" +
      "## Severity & Priority\n" +
      "**Severity:** <S1 Critical | S2 Major | S3 Minor | S4 Trivial>\n" +
      "**Priority:** <P0 Now | P1 Next sprint | P2 Backlog | P3 Nice-to-fix>\n" +
      "**Rationale:** <one line justifying the classification>\n" +
      "\n" +
      "## Environment\n" +
      "- **Application:** <app name + version/build>\n" +
      "- **Environment:** <Prod | Staging | QA | Local>\n" +
      "- **Browser/Device:** <Chrome 138 on macOS 15.2 | iPhone 15 Pro iOS 18 | N/A>\n" +
      "- **URL/Endpoint:** <specific URL or API endpoint if applicable>\n" +
      "- **User role/account:** <if auth-dependent>\n" +
      "- **Timestamp (first observed):** <ISO 8601 + timezone>\n" +
      "\n" +
      "## Reproduction steps\n" +
      "1. <Numbered, atomic, deterministic steps>\n" +
      "2. <Each step should be one action a human or automation can perform>\n" +
      "3. <Include exact input values, not \"some text\">\n" +
      "\n" +
      "**Reproduction rate:** <100% | Intermittent (~X%) | Once, could not reproduce>\n" +
      "**Pre-conditions:** <any state setup required before step 1>\n" +
      "\n" +
      "## Expected result\n" +
      "<What should happen, per requirement/spec. Link to the spec if possible.>\n" +
      "\n" +
      "## Actual result\n" +
      "<What actually happens. Be specific \u2014 \"it breaks\" is not a result. Include exact error text, incorrect data, wrong UI state, etc.>\n" +
      "\n" +
      "## Evidence\n" +
      "- **Screenshots:** <paths or links>\n" +
      "- **Screen recording:** <link if applicable>\n" +
      "- **Network HAR / request-response:** <attach or paste relevant request>\n" +
      "- **Logs:** <paste relevant log excerpt in code block with timestamps>\n" +
      "- **Stack trace:** <paste in code block>\n" +
      "\n" +
      "## Root cause hypothesis\n" +
      "<If you can reasonably hypothesize \u2014 not speculation, but \"based on the stack trace, this looks like a NullPointerException in the user-avatar resolver when the user has no uploaded image\". Prefix with \"Hypothesis:\" so it's clearly not confirmed.>\n" +
      "\n" +
      "## Suggested regression tests\n" +
      "<2-3 test cases to add so this doesn't come back. Reference existing test suite location if known.>\n" +
      "\n" +
      "## Related\n" +
      "- **Similar issues:** <links to Jira/GitHub issues that might be related>\n" +
      "- **Affected features:** <other areas of the product that might share the root cause>\n" +
      "- **Blocking/blocked by:** <ticket keys>\n" +
      "```\n" +
      "\n" +
      "## Severity definitions (do not fudge these)\n" +
      "\n" +
      "- **S1 Critical** \u2014 Data loss, security vulnerability, production down, no workaround, affects all users or majority of users\n" +
      "- **S2 Major** \u2014 Core feature broken, significant user impact, workaround exists but painful\n" +
      "- **S3 Minor** \u2014 Non-core feature broken or degraded, easy workaround, affects limited users\n" +
      "- **S4 Trivial** \u2014 Cosmetic, typo, minor UI glitch, no functional impact\n" +
      "\n" +
      "## Priority vs. Severity\n" +
      "\n" +
      "Severity is technical impact. Priority is business urgency. They are not the same. A cosmetic bug on the CEO's vanity page is S4 but might be P0. A crash in an unused feature is S1 but might be P2. Classify both independently and justify.\n" +
      "\n" +
      "## Reproduction steps \u2014 the non-negotiable rules\n" +
      "\n" +
      "1. **Start from a known state.** \"Log in as admin\" not \"while logged in\".\n" +
      "2. **One action per step.** \"Click X, then Y\" is two steps.\n" +
      "3. **Exact values.** \"Enter 'test@example.com'\" not \"enter an email\".\n" +
      "4. **Include wait conditions.** \"Wait for the dashboard to load (spinner disappears)\".\n" +
      "5. **Specify where clicks happen.** \"Click the 'Submit' button in the modal header\" not just \"click submit\".\n" +
      "6. **Numbered, not bulleted.** Numbers imply order; bullets don't.\n" +
      "\n" +
      "A bug report where the dev can't reproduce is a bug report that gets closed as \"cannot reproduce\" and comes back later. Treat reproduction steps as the most important section.\n" +
      "\n" +
      "## Handling different input types\n" +
      "\n" +
      "### User pastes an error / stack trace\n" +
      "- Extract the actual error message and class/type\n" +
      "- Identify the originating file and line from the stack\n" +
      "- Propose a root cause hypothesis if the stack is clear enough\n" +
      "- Ask for reproduction steps if they're not provided \u2014 don't guess\n" +
      "\n" +
      "### User describes behavior informally\n" +
      "- Convert to structured steps\n" +
      "- Fill in gaps by asking specific questions (environment, browser, user role, data state)\n" +
      "- Never fabricate details. If you don't know the browser, write `<UNKNOWN \u2014 please fill in>` and ask.\n" +
      "\n" +
      "### User pastes a failed test output (Playwright, Pytest, Jest, etc.)\n" +
      "- Extract the test name, assertion that failed, expected vs. actual\n" +
      "- Include the test file path and line\n" +
      "- Include any screenshots/traces Playwright/Cypress captured\n" +
      "- Note whether it's flaky (mention retry behavior if visible)\n" +
      "\n" +
      "### User provides a screenshot\n" +
      "- Describe what the screenshot shows, don't rely on the reader having seen it\n" +
      "- Call out the specific element that's wrong and what's expected there\n" +
      "- If the screenshot has a URL bar, extract and include it in the environment section\n" +
      "\n" +
      "## Severity triage aid\n" +
      "\n" +
      "Ask yourself, in order:\n" +
      "1. Is data being lost or corrupted? \u2192 S1\n" +
      "2. Is there a security exposure? \u2192 S1\n" +
      "3. Is the core user flow broken for all/most users? \u2192 S1\n" +
      "4. Is a major feature broken with no workaround? \u2192 S2\n" +
      "5. Is a feature broken but usable via workaround? \u2192 S2/S3\n" +
      "6. Is it only cosmetic? \u2192 S4\n" +
      "\n" +
      "## MCP integrations\n" +
      "\n" +
      "- **Atlassian (Jira)**: After generating the report, offer to create the Jira issue directly. Ask for the project key and issue type first. Creating the ticket requires explicit permission.\n" +
      "- **Atlassian (Confluence)**: For long-form incident reports, offer to publish as a Confluence page under a specified space.\n" +
      "- **Microsoft 365 (Outlook)**: For bugs that need stakeholder notification, offer to draft the notification email (use the `message_compose_v1` tool shape).\n" +
      "- **Fireflies / Granola**: If the bug was discussed in a meeting, pull the relevant transcript excerpt as additional context in the \"Related\" section.\n" +
      "\n" +
      "## Quality gates\n" +
      "\n" +
      "Before returning, self-check:\n" +
      "- [ ] Summary is one line and readable in a ticket list\n" +
      "- [ ] Severity and priority are both set with rationale\n" +
      "- [ ] Reproduction steps are deterministic and numbered\n" +
      "- [ ] Expected vs. actual are both concrete and specific\n" +
      "- [ ] At least one piece of evidence is included (or explicitly requested from user)\n" +
      "- [ ] No placeholder text like \"TBD\" or \"N/A\" without explanation\n" +
      "\n" +
      "## Anti-patterns to flag in user's original description\n" +
      "\n" +
      "If the user's informal description has any of these, fix them in the output and briefly note what you improved:\n" +
      "- \"Sometimes it doesn't work\" \u2192 push for reproduction rate and conditions\n" +
      "- \"It's slow\" \u2192 ask for baseline and measurement (ms, s)\n" +
      "- \"The UI is broken\" \u2192 ask which element, which breakpoint\n" +
      "- \"It crashed\" \u2192 ask for error message, log excerpt, timestamp\n" +
      "\n" +
      "## Tone\n" +
      "\n" +
      "Neutral, factual, no blame. Bug reports are not the place for editorializing (\"this is stupid\"), accusation (\"who wrote this?\"), or speculation presented as fact. Stick to observed behavior and evidence.\n" +
      "\n" +
      "---\n" +
      "\n" +
      "# n8n Runtime Contract \u2014 Agent: Bug Report (overrides anything above that conflicts)\n" +
      "\n" +
      "Runs in WF2 for each triage issue with category ProductBug and confidence \u2265 0.7. Input: the triage issue, run URL, artifact evidence, ticket under test. Unattended; you cannot ask questions \u2014 write `<UNKNOWN \u2014 please fill in>` for facts not in the input. Never fabricate.\n" +
      "\n" +
      "`markdown` = the full report using the \"Required structure\" template above. `sheet_row` = the **Standard Bug Sheet** fields (one row per bug).\n" +
      "\n" +
      "## Output \u2014 STRICT JSON ONLY\n" +
      "```json\n" +
      "{\n" +
      "  \"title\": \"[BUG] Order status stays 'Pending' after successful payment\",\n" +
      "  \"summary\": \"...\",\n" +
      "  \"severity\": \"S2\",\n" +
      "  \"priority\": \"P1\",\n" +
      "  \"rationale\": \"...\",\n" +
      "  \"module\": \"checkout\",\n" +
      "  \"environment\": { \"application\": \"...\", \"environment\": \"QA\", \"browser\": \"chromium\", \"url\": \"...\", \"build\": \"<commit sha>\" },\n" +
      "  \"steps\": [\"1 ...\", \"2 ...\"],\n" +
      "  \"reproduction_rate\": \"100% (3/3 CI attempts)\",\n" +
      "  \"preconditions\": \"...\",\n" +
      "  \"expected\": \"...\",\n" +
      "  \"actual\": \"...\",\n" +
      "  \"evidence\": [\"<run url>\", \"<trace path>\"],\n" +
      "  \"hypothesis\": \"Hypothesis: ...\",\n" +
      "  \"regression_tests\": [\"...\"],\n" +
      "  \"markdown\": \"# [BUG] ...\",\n" +
      "  \"sheet_row\": {\n" +
      "    \"Bug ID\": \"\", \"Jira Key\": \"\", \"Title\": \"\", \"Module\": \"\", \"Severity\": \"S2\", \"Priority\": \"P1\",\n" +
      "    \"Status\": \"Open\", \"Environment\": \"QA\", \"Browser\": \"chromium\", \"Build\": \"\", \"Steps\": \"\", \"Expected\": \"\", \"Actual\": \"\",\n" +
      "    \"Evidence\": \"\", \"Reported Date\": \"YYYY-MM-DD\", \"Reported By\": \"QA Automation (n8n)\", \"Source Ticket\": \"\",\n" +
      "    \"CI Run\": \"\", \"Verified Date\": \"\", \"Verified By\": \"\", \"Regression Test ID\": \"\"\n" +
      "  }\n" +
      "}\n" +
      "```\n" +
      "Allowed `severity`: S1|S2|S3|S4. Allowed `priority`: P0|P1|P2|P3. Leave `Bug ID` and `Jira Key` empty \u2014 the workflow fills them after creating the Jira issue.\n"), maxIterations: 3 }
    },
    subnodes: { model: bugModel }
  },
  output: [{ output: '{"title":"[BUG] x"}' }]
});

const validateBug = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Bug JSON', parameters: { mode: 'runOnceForEachItem', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
      "function parseAgentJson(raw, label) {\n" +
      "  if (raw && typeof raw === 'object') return raw;\n" +
      "  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`[${label}] empty/non-string agent output`);\n" +
      "  let s = raw.trim();\n" +
      "  const m = s.match(/^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/i);\n" +
      "  if (m) s = m[1].trim();\n" +
      "  try { return JSON.parse(s); } catch (e) { throw new Error(`[${label}] invalid JSON (${e.message}): ${s.slice(0, 300)}`); }\n" +
      "}\n" +
      "// schema: {type:'object'|'array'|'string'|'number'|'boolean'|'any', required, props, items, minItems, enum, pattern, minLength, min, max, nullable}\n" +
      "function checkSchema(v, s, p, e) {\n" +
      "  if (v === null || v === undefined) { if (!(s.nullable && v === null)) e.push(`${p} is ${v === null ? 'null' : 'missing'}`); return; }\n" +
      "  const t = s.type;\n" +
      "  if (t === 'any') return;\n" +
      "  if (t === 'object') {\n" +
      "    if (typeof v !== 'object' || Array.isArray(v)) return void e.push(`${p} must be an object`);\n" +
      "    (s.required || []).forEach((k) => { if (!(k in v)) e.push(`${p}.${k} is required`); });\n" +
      "    Object.entries(s.props || {}).forEach(([k, sub]) => { if (k in v) checkSchema(v[k], sub, `${p}.${k}`, e); });\n" +
      "  } else if (t === 'array') {\n" +
      "    if (!Array.isArray(v)) return void e.push(`${p} must be an array`);\n" +
      "    if (s.minItems && v.length < s.minItems) e.push(`${p} needs >= ${s.minItems} items`);\n" +
      "    if (s.items) v.forEach((x, i) => checkSchema(x, s.items, `${p}[${i}]`, e));\n" +
      "  } else if (t === 'string') {\n" +
      "    if (typeof v !== 'string') return void e.push(`${p} must be a string`);\n" +
      "    if (s.minLength && v.length < s.minLength) e.push(`${p} too short`);\n" +
      "    if (s.enum && !s.enum.includes(v)) e.push(`${p} must be one of ${s.enum.join('|')} (got \"${v}\")`);\n" +
      "    if (s.pattern && !new RegExp(s.pattern).test(v)) e.push(`${p} must match /${s.pattern}/`);\n" +
      "  } else if (t === 'number') {\n" +
      "    if (typeof v !== 'number' || Number.isNaN(v)) return void e.push(`${p} must be a number`);\n" +
      "    if (s.min !== undefined && v < s.min) e.push(`${p} must be >= ${s.min}`);\n" +
      "    if (s.max !== undefined && v > s.max) e.push(`${p} must be <= ${s.max}`);\n" +
      "  } else if (t === 'boolean') { if (typeof v !== 'boolean') e.push(`${p} must be a boolean`); }\n" +
      "  else e.push(`${p}: unknown schema type ${t}`);\n" +
      "}\n" +
      "function assertSchema(v, s, label) {\n" +
      "  const e = []; checkSchema(v, s, '$', e);\n" +
      "  if (e.length) throw new Error(`[${label}] schema mismatch (${e.length}): ${e.slice(0, 12).join('; ')}`);\n" +
      "  return v;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ctx = $('Route Issue').item.json;\n" +
      "const bug = parseAgentJson($input.item.json.output, 'Bug Report');\n" +
      "assertSchema(bug, {\n" +
      "  type: 'object',\n" +
      "  required: ['title', 'summary', 'severity', 'priority', 'rationale', 'module', 'environment', 'steps', 'reproduction_rate', 'expected', 'actual', 'evidence', 'hypothesis', 'markdown', 'sheet_row'],\n" +
      "  props: {\n" +
      "    title: { type: 'string', pattern: '^\\\\[BUG\\\\] ' },\n" +
      "    severity: { type: 'string', enum: ['S1', 'S2', 'S3', 'S4'] },\n" +
      "    priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },\n" +
      "    steps: { type: 'array', minItems: 1, items: { type: 'string' } },\n" +
      "    evidence: { type: 'array', minItems: 1, items: { type: 'string' } },\n" +
      "    markdown: { type: 'string', minLength: 50 },\n" +
      "    sheet_row: { type: 'object', required: ['Title', 'Module', 'Severity', 'Priority', 'Status', 'Steps', 'Expected', 'Actual'] },\n" +
      "  },\n" +
      "}, 'Bug Report');\n" +
      "const jiraPriority = { P0: 'Highest', P1: 'High', P2: 'Medium', P3: 'Low' }[bug.priority];\n" +
      "return { json: { ...ctx, bug, jira_priority: jiraPriority } };\n") } },
  output: [{ ticket: 'PROJ-101', module: 'checkout-coupon', run_url: 'https://github.com/acme/webapp/actions/runs/1', head_sha: 'c0ffee1234', bug: { title: '[BUG] x', markdown: '# [BUG] x', severity: 'S2', priority: 'P1', sheet_row: {} }, jira_priority: 'High' }]
});

const createBug = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Create Bug',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
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
  config: { name: 'Build Bug Sheet Row', parameters: { mode: 'runOnceForEachItem', jsCode: ("// Standard Bug Sheet row, completed with the Jira key returned by the create call.\n" +
      "const src = $('Validate Bug JSON').item.json;\n" +
      "const key = $input.item.json.key;\n" +
      "const today = $now.setZone('Asia/Karachi').toFormat('yyyy-MM-dd');\n" +
      "return { json: { ...src.bug.sheet_row, 'Bug ID': key, 'Jira Key': key, 'Status': 'Open', 'Reported Date': src.bug.sheet_row['Reported Date'] && !/Y/.test(src.bug.sheet_row['Reported Date']) ? src.bug.sheet_row['Reported Date'] : today, 'Source Ticket': src.ticket, 'CI Run': src.run_url, 'Build': src.head_sha } };\n") } },
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/actions/runs/{{ $json.run_id }}/rerun-failed-jobs'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
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
  config: { name: 'Build Triage Summary', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $input.first().json;\n" +
      "const icon = { BLOCK: ':no_entry:', ALLOW_AFTER_FIX: ':warning:', ALLOW: ':white_check_mark:' }[ctx.merge_decision];\n" +
      "const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);\n" +
      "const rows = ctx.triage.issues.map((i, k) => `${pad(k + 1, 2)} ${pad(i.category, 11)} ${pad(i.confidence.toFixed(2), 4)} ${pad(i.route, 12)} ${pad(i.tests[0]?.title, 46)}`);\n" +
      "const text = `${icon} *qa-pr triage* \u2014 ${ctx.ticket || ctx.head_branch} \u00b7 <${ctx.run_url}|run ${ctx.run_id}> (attempt ${ctx.run_attempt})\\n` +\n" +
      "  `Total ${ctx.total} \u00b7 Failed ${ctx.failed} \u00b7 Unique issues ${ctx.triage.issues.length}\\n` +\n" +
      "  '```\\n# Category    Conf Route        Test\\n' + rows.join('\\n') + '\\n```\\n' +\n" +
      "  `*MERGE: ${ctx.merge_decision}*` + (ctx.agent_merge_decision !== ctx.merge_decision ? ` (agent suggested ${ctx.agent_merge_decision})` : '') +\n" +
      "  (ctx.pr_url ? `\\nPR: ${ctx.pr_url}` : '') + '\\nQA owns the final call \u2014 nothing is merged or closed automatically.';\n" +
      "return [{ json: { ...ctx, slack_text: text } }];\n") } },
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
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.row_key }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $json.ticket }}'), branch: expr('{{ $json.branch }}'), pr_url: expr('{{ $json.pr_url }}'),
          run_id: expr('{{ $json.run_id }}'), status: 'failed', kind: expr('{{ $json.kind }}'), dispatch_id: expr('{{ $json.row_key }}'),
          conclusion: expr('{{ $json.conclusion }}'), merge_decision: expr('{{ $json.merge_decision }}'), module: expr('{{ $json.module }}')
        },
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
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
