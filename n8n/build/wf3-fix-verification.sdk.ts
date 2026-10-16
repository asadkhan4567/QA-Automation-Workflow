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
          { id: 'c1', name: 'JIRA_PROJECT', value: '<SET_ME:JIRA_PROJECT>', type: 'string' },
          { id: 'c2', name: 'JIRA_BASE_URL', value: '<SET_ME:JIRA_BASE_URL>', type: 'string' },
          { id: 'c3', name: 'GITHUB_OWNER', value: '<SET_ME:GITHUB_OWNER>', type: 'string' },
          { id: 'c4', name: 'GITHUB_REPO', value: '<SET_ME:GITHUB_REPO>', type: 'string' },
          { id: 'c5', name: 'BASE_BRANCH', value: 'main', type: 'string' },
          { id: 'c6', name: 'SLACK_CHANNEL', value: '<SET_ME:SLACK_CHANNEL>', type: 'string' },
          { id: 'c7', name: 'BUG_SHEET_ID', value: '<SET_ME:BUG_SHEET_ID>', type: 'string' },
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
  config: { name: 'Normalize Bugs', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Jira Fixed bugs -> flat objects (description may be ADF on API v3).\n" +
      "function adfToText(n) {\n" +
      "  if (!n) return '';\n" +
      "  if (typeof n === 'string') return n;\n" +
      "  if (n.type === 'text') return n.text || '';\n" +
      "  const inner = (n.content || []).map(adfToText).join('');\n" +
      "  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(n.type) ? inner + '\\n' : inner;\n" +
      "}\n" +
      "return $input.all().filter((i) => i.json && i.json.key).map((i) => {\n" +
      "  const f = i.json.fields || {};\n" +
      "  return { json: { key: i.json.key, summary: f.summary || '', description: adfToText(f.description).trim().slice(0, 6000), labels: f.labels || [], components: (f.components || []).map((c) => c.name), priority: f.priority?.name || '', status: f.status?.name || '', fix_versions: (f.fixVersions || []).map((v) => v.name) } };\n" +
      "});\n") } },
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
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
  config: { name: 'Verification Context', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Gather everything the Verification agent needs for one Fixed bug.\n" +
      "const bug = $('Current Bug').last().json;\n" +
      "const comments = ($('Jira \u00b7 Get Comments').last().json.comments || []).slice(-15).map((c) => ({ author: c.author?.displayName, created: c.created, body: String(c.body || '').slice(0, 1500) }));\n" +
      "const links = $('Jira \u00b7 Get Remote Links').all().map((i) => i.json).filter((l) => l && l.object).map((l) => ({ title: l.object.title, url: l.object.url }));\n" +
      "const sheet = $('Bug Sheet \u00b7 Find Row').all().map((i) => i.json).find((r) => r && (r['Jira Key'] === bug.key || r['Bug ID'] === bug.key)) || null;\n" +
      "return [{ json: { bug, comments, links, sheet_row: sheet } }];\n") } },
  output: [{ bug: { key: 'PROJ-131' }, comments: [], links: [], sheet_row: null }]
});

const verifyModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Verification (t=0)',
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0, maxTokensToSample: 4000 } },
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
      options: { systemMessage: ("<!-- Source skill: fix-verification (SKILL.md body, verbatim) + n8n runtime contract appended below. -->\n" +
      "\n" +
      "\n" +
      "# Fix Verification (SOP Stage 7 \u2014 Verify)\n" +
      "\n" +
      "## Input\n" +
      "Bug ID (`CN-BUG-###`) and/or Jira key, with status = Fixed.\n" +
      "\n" +
      "## Step 1 \u2014 Load the bug\n" +
      "- Fetch from Jira: summary, steps, expected/actual, environment, browser, severity, reproduction rate, linked PR/commit.\n" +
      "- Get the matching row from the Standard Bug Sheet.\n" +
      "\n" +
      "## Step 2 \u2014 Confirm the fix is deployed\n" +
      "- Confirm the fix PR is merged and the build/commit is deployed to the target environment.\n" +
      "- Record the build/version. If not deployed \u2192 stop: `NOT READY \u2014 fix not on <env>`.\n" +
      "\n" +
      "## Step 3 \u2014 Re-test\n" +
      "- Same environment and browser as the original report.\n" +
      "- Run the original steps exactly (manual or Playwright).\n" +
      "- If reproduction was intermittent: run `npx playwright test <spec> --repeat-each=10`; all 10 must pass.\n" +
      "- For UI bugs, test all 3 engines (chromium, firefox, webkit).\n" +
      "\n" +
      "## Step 4 \u2014 Regression check\n" +
      "- Run tests for the same module: `npx playwright test --grep \"@<module>\"`.\n" +
      "- Check nearby flows for side effects.\n" +
      "\n" +
      "## Step 5 \u2014 Lock it in\n" +
      "- If no automated test covers this bug: create one with `browser-automation`, tag `@regression @<module>`, title includes the bug ID.\n" +
      "- The test must fail on the old build (if available) and pass on the fixed one.\n" +
      "\n" +
      "## Step 6 \u2014 Decide\n" +
      "| Result | Status | Action |\n" +
      "|---|---|---|\n" +
      "| All pass | Verified \u2192 Closed | Update sheet + Jira |\n" +
      "| Original issue persists | Reopened | Add new evidence; assign back to dev |\n" +
      "| Fixed but new break found | Verified + new bug | Close original; new bug via `bug-report-writer` |\n" +
      "| Can't test (env/data) | Blocked | Note the blocker; keep as Fixed |\n" +
      "\n" +
      "## Step 7 \u2014 Update records\n" +
      "Bug sheet: Status, Verified Date (YYYY-MM-DD), Verified By, Build, Regression Test ID.\n" +
      "\n" +
      "Jira comment template:\n" +
      "```\n" +
      "Verification \u2014 <PASS/FAIL>\n" +
      "Build: <version/commit> | Env: <env> | Browser(s): <list>\n" +
      "Original steps: <pass/fail>\n" +
      "Repeat runs: <n/n passed>\n" +
      "Regression (@<module>): <passed/failed>\n" +
      "Regression test added: <spec path / test ID>\n" +
      "Evidence: <links>\n" +
      "```\n" +
      "Then transition: Verified \u2192 Closed, or Reopened.\n" +
      "\n" +
      "## Rules\n" +
      "- Never close without re-running the original steps.\n" +
      "- S1/S2 need evidence (screenshot/video/trace) attached.\n" +
      "- Don't transition Jira without user confirmation.\n" +
      "- A human QA signs off; this skill drafts and executes the checks.\n" +
      "\n" +
      "---\n" +
      "\n" +
      "# n8n Runtime Contract \u2014 Agent: Fix Verification (overrides anything above that conflicts)\n" +
      "\n" +
      "Runs in WF3 for each Jira bug with status = Fixed. Input: the Jira bug (fields, description, comments, linked PRs) and its Bug Sheet row (may be empty). You PLAN the verification; the workflow dispatches CI with your grep and `repeat-each=10` across chromium/firefox/webkit and decides PASS/FAIL deterministically from the CI result.\n" +
      "\n" +
      "Policy overrides for this deployment:\n" +
      "- **Never transition to Closed.** PASS \u2192 `Verified` only; a human QA closes. FAIL \u2192 `Reopened`.\n" +
      "- If no linked fix PR/commit or deploy evidence is visible, set `ready=false` with `not_ready_reason` (the bug stays Fixed and is reported as Blocked).\n" +
      "- `module` must match the `@<module>` tag used by the original tests (derive from labels/components/sheet row).\n" +
      "\n" +
      "## Output \u2014 STRICT JSON ONLY\n" +
      "```json\n" +
      "{\n" +
      "  \"bug_key\": \"PROJ-456\",\n" +
      "  \"ready\": true,\n" +
      "  \"not_ready_reason\": null,\n" +
      "  \"module\": \"checkout\",\n" +
      "  \"grep\": \"@checkout\",\n" +
      "  \"repeat_each\": 10,\n" +
      "  \"projects\": [\"chromium\", \"firefox\", \"webkit\"],\n" +
      "  \"original_steps\": [\"1 ...\", \"2 ...\"],\n" +
      "  \"regression_test_exists\": true,\n" +
      "  \"regression_test_hint\": \"tests/e2e/proj-123/checkout.spec.ts \u2014 TC-03\",\n" +
      "  \"build\": \"<commit sha or version, or <UNKNOWN>>\"\n" +
      "}\n" +
      "```\n" +
      "`repeat_each` must be 10. `grep` must start with `@`.\n"), maxIterations: 3 }
    },
    subnodes: { model: verifyModel }
  },
  output: [{ output: '{"bug_key":"PROJ-131","ready":true,"not_ready_reason":null,"module":"checkout-coupon","grep":"@checkout-coupon","repeat_each":10,"projects":["chromium","firefox","webkit"],"original_steps":[],"regression_test_exists":true,"regression_test_hint":"TC-02","build":"2026.10.15-3"}' }]
});

const validateVerify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Verification JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
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
      "const ctx = $('Verification Context').last().json;\n" +
      "const plan = parseAgentJson($input.first().json.output, 'Fix Verification');\n" +
      "assertSchema(plan, {\n" +
      "  type: 'object', required: ['bug_key', 'ready', 'module', 'grep', 'repeat_each', 'projects', 'original_steps', 'regression_test_exists', 'build'],\n" +
      "  props: {\n" +
      "    bug_key: { type: 'string', enum: [ctx.bug.key] },\n" +
      "    ready: { type: 'boolean' },\n" +
      "    not_ready_reason: { type: 'string', nullable: true },\n" +
      "    module: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },\n" +
      "    grep: { type: 'string', pattern: '^@[A-Za-z0-9-]+$' },\n" +
      "    repeat_each: { type: 'number', min: 10, max: 10 },\n" +
      "    projects: { type: 'array', minItems: 1, items: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] } },\n" +
      "    original_steps: { type: 'array', items: { type: 'string' } },\n" +
      "    regression_test_exists: { type: 'boolean' },\n" +
      "    build: { type: 'string' },\n" +
      "  },\n" +
      "}, 'Fix Verification');\n" +
      "if (!plan.ready && !plan.not_ready_reason) throw new Error('[Fix Verification] ready=false requires not_ready_reason');\n" +
      "return [{ json: { ...ctx, plan } }];\n") } },
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
  config: { name: 'Build Verification Dispatch', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $input.first().json;\n" +
      "const cfg = $('Config').first().json;\n" +
      "const key = ctx.bug.key;\n" +
      "const projects = [...new Set([...ctx.plan.projects, 'chromium', 'firefox', 'webkit'])].join(','); // skill: UI bugs on all 3 engines\n" +
      "return [{ json: { ...ctx, dispatch_id: `VERIFY-${key}-${$execution.id}-${Date.now()}`, ref: cfg.BASE_BRANCH, grep: ctx.plan.grep, repeat_each: String(ctx.plan.repeat_each), projects, polls: 0, started_at: $now.toISO() } }];\n") } },
  output: [{ bug: { key: 'PROJ-131' }, plan: { build: 'x', regression_test_exists: true }, dispatch_id: 'VERIFY-PROJ-131-1-1', ref: 'main', grep: '@checkout-coupon', repeat_each: '10', projects: 'chromium,firefox,webkit', polls: 0 }]
});

const recordVerify = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Register Verification',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $json.bug.key }}'), branch: expr('{{ $json.ref }}'), pr_url: '', run_id: '', status: 'ci_dispatched',
          kind: 'verification', dispatch_id: expr('{{ $json.dispatch_id }}'), module: expr('{{ $json.plan.module }}')
        },
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/actions/workflows/qa-pr.yml/dispatches'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ ref: $("Build Verification Dispatch").last().json.ref, inputs: { ticket: $("Build Verification Dispatch").last().json.bug.key, branch: $("Build Verification Dispatch").last().json.ref, grep: $("Build Verification Dispatch").last().json.grep, repeat_each: $("Build Verification Dispatch").last().json.repeat_each, projects: $("Build Verification Dispatch").last().json.projects, dispatch_id: $("Build Verification Dispatch").last().json.dispatch_id } }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
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
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispatch_id', condition: 'eq', keyValue: expr('{{ $json.dispatch_id }}') }] }
    }
  },
  output: [{ id: 7, status: 'passed', run_id: '11900000001', conclusion: 'success' }]
});

const checkResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Check Result', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Poll result written by WF2 into qa_runs (kind=verification).\n" +
      "const MAX_POLLS = 18; // 18 x 5 min = 90 min\n" +
      "const ctx = $('Wait for WF2 Result').last().json;\n" +
      "const row = $input.all().map((i) => i.json).find((r) => r && r.id !== undefined) || {};\n" +
      "const polls = (ctx.polls || 0) + 1;\n" +
      "const outcome = row.status === 'passed' ? 'pass' : row.status === 'failed' ? 'fail' : polls >= MAX_POLLS ? 'timeout' : 'pending';\n" +
      "const cfg = $('Config').first().json;\n" +
      "const run_url = row.run_id ? `https://github.com/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/runs/${row.run_id}` : '';\n" +
      "return [{ json: { ...ctx, polls, outcome, run_id: row.run_id || '', run_url, conclusion: row.conclusion || '' } }];\n") } },
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
  config: { name: 'Verification Decision', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Verification decision + Jira comment (fix-verification skill template). Never Closed: PASS -> Verified, FAIL -> Reopened.\n" +
      "const ctx = $input.first().json;\n" +
      "const pass = ctx.outcome === 'pass';\n" +
      "const today = $now.setZone('Asia/Karachi').toFormat('yyyy-MM-dd');\n" +
      "const comment = [\n" +
      "  `Verification \u2014 ${pass ? 'PASS' : 'FAIL'}`,\n" +
      "  `Build: ${ctx.plan.build} | Env: QA | Browser(s): ${ctx.projects.split(',').join(', ')}`,\n" +
      "  `Original steps: ${pass ? 'pass' : 'fail'}`,\n" +
      "  `Repeat runs: --repeat-each=${ctx.repeat_each} across ${ctx.projects.split(',').length} engines \u2014 ${pass ? 'all passed' : 'at least one failed'}`,\n" +
      "  `Regression (${ctx.grep}): ${pass ? 'passed' : 'failed'}`,\n" +
      "  `Regression test added: ${ctx.plan.regression_test_exists ? (ctx.plan.regression_test_hint || 'existing test') : 'NONE \u2014 add one tagged @regression ' + ctx.grep + ' with the bug ID in the title'}`,\n" +
      "  `Evidence: ${ctx.run_url || 'n/a'}`,\n" +
      "  '',\n" +
      "  pass ? 'Transitioning to Verified. A human QA must sign off and close \u2014 automation never closes tickets.' : 'Transitioning to Reopened with the evidence above; assigning back to development.',\n" +
      "].join('\\n');\n" +
      "return [{ json: { ...ctx, verdict: pass ? 'PASS' : 'FAIL', target_statuses: pass ? ['Verified'] : ['Reopened', 'Reopen'], sheet_status: pass ? 'Verified' : 'Reopened', verified_date: pass ? today : '', comment } }];\n") } },
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
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
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
  config: { name: 'Pick Transition (never Closed)', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $('Verification Decision').last().json;\n" +
      "const transitions = $input.first().json.transitions || [];\n" +
      "const want = ctx.target_statuses.map((s) => s.toLowerCase());\n" +
      "const t = transitions.find((x) => want.includes(String(x.to?.name || '').toLowerCase()) || want.includes(String(x.name || '').toLowerCase()));\n" +
      "if (!t) throw new Error(`[Fix Verification] no transition to ${ctx.target_statuses.join('/')} available for ${ctx.bug.key} (have: ${transitions.map((x) => x.name + '\u2192' + (x.to?.name || '?')).join(', ')})`);\n" +
      "if (/clos|done|resolv/i.test(String(t.to?.name || t.name))) throw new Error(`[Fix Verification] refusing transition \"${t.name}\" \u2014 automation never closes tickets`);\n" +
      "return [{ json: { ...ctx, transition_id: t.id, transition_name: t.name } }];\n") } },
  output: [{ bug: { key: 'PROJ-131' }, transition_id: '41', transition_name: 'Verify', sheet_status: 'Verified' }]
});

const doTransition = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Transition Bug',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
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
