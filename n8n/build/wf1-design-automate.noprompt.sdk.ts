import { workflow, node, trigger, sticky, newCredential, ifElse, splitInBatches, nextBatch, languageModel, expr } from '@n8n/workflow-sdk';

const manualRun = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Manually' },
  output: [{}]
});

const every2h = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: { name: 'Every 2 Hours', parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } } },
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
          { id: 'cfg-jira-project', name: 'JIRA_PROJECT', value: '<SET_ME:JIRA_PROJECT>', type: 'string' },
          { id: 'cfg-jira-base', name: 'JIRA_BASE_URL', value: '<SET_ME:JIRA_BASE_URL>', type: 'string' },
          { id: 'cfg-gh-owner', name: 'GITHUB_OWNER', value: '<SET_ME:GITHUB_OWNER>', type: 'string' },
          { id: 'cfg-gh-repo', name: 'GITHUB_REPO', value: '<SET_ME:GITHUB_REPO>', type: 'string' },
          { id: 'cfg-base-branch', name: 'BASE_BRANCH', value: 'main', type: 'string' },
          { id: 'cfg-slack', name: 'SLACK_CHANNEL', value: '<SET_ME:SLACK_CHANNEL>', type: 'string' },
          { id: 'cfg-qa-url', name: 'QA_BASE_URL', value: '<SET_ME:QA_BASE_URL>', type: 'string' },
          { id: 'cfg-pr-draft', name: 'PR_DRAFT', value: true, type: 'boolean' }
        ]
      }
    }
  },
  output: [{ JIRA_PROJECT: 'PROJ', JIRA_BASE_URL: 'https://example.atlassian.net', GITHUB_OWNER: 'acme', GITHUB_REPO: 'webapp', BASE_BRANCH: 'main', SLACK_CHANNEL: 'qa-automation', QA_BASE_URL: 'https://qa.example.com', PR_DRAFT: true }]
});

const searchTickets = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Search Ready-for-QA Tickets',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud',
      resource: 'issue',
      operation: 'getAll',
      returnAll: true,
      options: {
        jql: expr('project = "{{ $json.JIRA_PROJECT }}" AND sprint in openSprints() AND status = "Ready for QA" AND (labels is EMPTY OR labels != "qa-automated") ORDER BY priority DESC, created ASC'),
        fields: 'summary,description,labels,components,priority,status,issuetype'
      }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ key: 'PROJ-101', fields: { summary: 'Apply coupon at checkout', description: 'AC1: valid coupon reduces total. AC2: expired coupon shows error.', labels: ['checkout'], components: [{ name: 'Checkout' }], priority: { name: 'High' }, status: { name: 'Ready for QA' }, issuetype: { name: 'Story' } } }]
});

const normalizeTickets = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Normalize Tickets', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Jira issues -> flat ticket objects. Description may be plain text (API v2) or ADF (API v3).\n" +
      "const cfg = $('Config').first().json;\n" +
      "function adfToText(node) {\n" +
      "  if (!node) return '';\n" +
      "  if (typeof node === 'string') return node;\n" +
      "  if (node.type === 'text') return node.text || '';\n" +
      "  const inner = (node.content || []).map(adfToText).join(node.type === 'bulletList' || node.type === 'orderedList' ? '\\n' : '');\n" +
      "  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? inner + '\\n' : inner;\n" +
      "}\n" +
      "return $input.all()\n" +
      "  .filter((i) => i.json && i.json.key)\n" +
      "  .map((i) => {\n" +
      "    const f = i.json.fields || {};\n" +
      "    return {\n" +
      "      json: {\n" +
      "        key: i.json.key,\n" +
      "        summary: f.summary || '',\n" +
      "        description: adfToText(f.description).trim(),\n" +
      "        labels: f.labels || [],\n" +
      "        components: (f.components || []).map((c) => c.name),\n" +
      "        priority: f.priority?.name || '',\n" +
      "        status: f.status?.name || '',\n" +
      "        issuetype: f.issuetype?.name || '',\n" +
      "        url: `${String(cfg.JIRA_BASE_URL).replace(/\\/$/, '')}/browse/${i.json.key}`,\n" +
      "      },\n" +
      "    };\n" +
      "  });\n") } },
  output: [{ key: 'PROJ-101', summary: 'Apply coupon at checkout', description: 'AC1 ... AC2 ...', labels: ['checkout'], components: ['Checkout'], priority: 'High', status: 'Ready for QA', issuetype: 'Story', url: 'https://example.atlassian.net/browse/PROJ-101' }]
});

const skipProcessed = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Skip Tickets Already in qa_runs',
    parameters: {
      resource: 'row',
      operation: 'rowNotExists',
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      matchType: 'anyCondition',
      filters: { conditions: [{ keyName: 'ticket', keyValue: expr('{{ $json.key }}') }] }
    }
  },
  output: [{ key: 'PROJ-101', summary: 'Apply coupon at checkout', description: 'AC1 ... AC2 ...', labels: ['checkout'], components: ['Checkout'], priority: 'High', status: 'Ready for QA', issuetype: 'Story', url: 'https://example.atlassian.net/browse/PROJ-101' }]
});

const loopTickets = splitInBatches({ version: 3, config: { name: 'Loop Tickets', parameters: { batchSize: 1 } } });

const currentTicket = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Current Ticket' },
  output: [{ key: 'PROJ-101', summary: 'Apply coupon at checkout', description: 'AC1 ... AC2 ...', labels: ['checkout'], components: ['Checkout'], url: 'https://example.atlassian.net/browse/PROJ-101' }]
});

const designModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Design (t=0.2)',
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0.2, maxTokensToSample: 8000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const testDesignAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Test Design Agent',
    parameters: {
      promptType: 'define',
      text: expr('Design test cases for this Jira ticket. Return STRICT JSON per the runtime contract.\n\nTICKET:\n{{ JSON.stringify($json, null, 2) }}'),
      options: { systemMessage: "[PROMPT PENDING: prompts/test-design.md \u2014 injected by update_workflow]", maxIterations: 3 }
    },
    subnodes: { model: designModel }
  },
  output: [{ output: '{"ticket":"PROJ-101","module":"checkout","has_endpoints":false,"endpoints":[],"touches_db":false,"db_entities":[],"assumptions":[],"gherkin":"Feature: Coupon","test_matrix":[{"id":"TC-01","title":"valid coupon","priority":"P0","type":"Positive","steps":["apply"],"expected":"total reduced","tags":["@PROJ-101","@checkout","@smoke"]}]}' }]
});

const validateDesign = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Test Design JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
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
      "const FILE_SCHEMA = { type: 'object', required: ['path', 'content'], props: { path: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } } };\n" +
      "function assertFiles(files, prefixes, label) {\n" +
      "  for (const f of files) {\n" +
      "    const p = f.path;\n" +
      "    if (p.includes('..') || p.startsWith('/') || p.includes('\\\\') || !prefixes.some((x) => p.startsWith(x))) throw new Error(`[${label}] path not allowed: \"${p}\" (allowed: ${prefixes.join(', ')})`);\n" +
      "    if (!p.endsWith('.ts')) throw new Error(`[${label}] only .ts files allowed: \"${p}\"`);\n" +
      "    if (/waitForTimeout\\s*\\(|setTimeout\\s*\\(/.test(f.content)) throw new Error(`[${label}] hard sleep found in ${p}`);\n" +
      "  }\n" +
      "  return files;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ticket = $('Current Ticket').last().json;\n" +
      "const design = parseAgentJson($input.first().json.output, 'Test Design');\n" +
      "assertSchema(design, {\n" +
      "  type: 'object',\n" +
      "  required: ['ticket', 'module', 'has_endpoints', 'endpoints', 'touches_db', 'db_entities', 'assumptions', 'gherkin', 'test_matrix'],\n" +
      "  props: {\n" +
      "    ticket: { type: 'string', enum: [ticket.key] },\n" +
      "    module: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },\n" +
      "    has_endpoints: { type: 'boolean' },\n" +
      "    endpoints: { type: 'array', items: { type: 'object', required: ['method', 'path'], props: { method: { type: 'string' }, path: { type: 'string' } } } },\n" +
      "    touches_db: { type: 'boolean' },\n" +
      "    db_entities: { type: 'array', items: { type: 'string' } },\n" +
      "    assumptions: { type: 'array', items: { type: 'string' } },\n" +
      "    gherkin: { type: 'string', minLength: 10 },\n" +
      "    test_matrix: {\n" +
      "      type: 'array', minItems: 1,\n" +
      "      items: {\n" +
      "        type: 'object',\n" +
      "        required: ['id', 'title', 'priority', 'type', 'steps', 'expected', 'tags'],\n" +
      "        props: {\n" +
      "          id: { type: 'string' }, title: { type: 'string' },\n" +
      "          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },\n" +
      "          type: { type: 'string', enum: ['Positive', 'Negative', 'Boundary', 'Security', 'Performance', 'Accessibility', 'Usability'] },\n" +
      "          steps: { type: 'array', minItems: 1, items: { type: 'string' } },\n" +
      "          expected: { type: 'string' },\n" +
      "          tags: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^@' } },\n" +
      "        },\n" +
      "      },\n" +
      "    },\n" +
      "  },\n" +
      "}, 'Test Design');\n" +
      "if (design.has_endpoints && design.endpoints.length === 0) throw new Error('[Test Design] has_endpoints=true but endpoints is empty');\n" +
      "return [{ json: { ticket, design, attempt: 0, review_feedback: [] } }];\n") } },
  output: [{ ticket: { key: 'PROJ-101', summary: 'Apply coupon at checkout' }, design: { module: 'checkout', has_endpoints: false, touches_db: false, test_matrix: [] }, attempt: 0, review_feedback: [] }]
});

const specContext = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Spec Context' },
  output: [{ ticket: { key: 'PROJ-101', summary: 'Apply coupon at checkout' }, design: { module: 'checkout', has_endpoints: false, touches_db: false, test_matrix: [] }, attempt: 0, review_feedback: [] }]
});

const specModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Spec (t=0.2)',
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0.2, maxTokensToSample: 16000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const specAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Spec Generator Agent',
    parameters: {
      promptType: 'define',
      text: expr('Generate Playwright TypeScript specs (POM + fixtures) for this ticket. Return STRICT JSON per the runtime contract.\n\nTICKET:\n{{ JSON.stringify($json.ticket, null, 2) }}\n\nTEST DESIGN:\n{{ JSON.stringify($json.design, null, 2) }}\n\nREVISION ATTEMPT: {{ $json.attempt }}\nreview_feedback (fix every item; empty on first attempt):\n{{ JSON.stringify($json.review_feedback, null, 2) }}'),
      options: { systemMessage: "[PROMPT PENDING: prompts/spec-generator.md \u2014 injected by update_workflow]", maxIterations: 3 }
    },
    subnodes: { model: specModel }
  },
  output: [{ output: '{"ticket":"PROJ-101","grep":"@PROJ-101","files":[{"path":"tests/e2e/proj-101/coupon.spec.ts","content":"// @PROJ-101"}],"notes":[]}' }]
});

const validateSpec = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Spec JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
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
      "const FILE_SCHEMA = { type: 'object', required: ['path', 'content'], props: { path: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } } };\n" +
      "function assertFiles(files, prefixes, label) {\n" +
      "  for (const f of files) {\n" +
      "    const p = f.path;\n" +
      "    if (p.includes('..') || p.startsWith('/') || p.includes('\\\\') || !prefixes.some((x) => p.startsWith(x))) throw new Error(`[${label}] path not allowed: \"${p}\" (allowed: ${prefixes.join(', ')})`);\n" +
      "    if (!p.endsWith('.ts')) throw new Error(`[${label}] only .ts files allowed: \"${p}\"`);\n" +
      "    if (/waitForTimeout\\s*\\(|setTimeout\\s*\\(/.test(f.content)) throw new Error(`[${label}] hard sleep found in ${p}`);\n" +
      "  }\n" +
      "  return files;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ctx = $('Spec Context').last().json;\n" +
      "const key = ctx.ticket.key;\n" +
      "const spec = parseAgentJson($input.first().json.output, 'Spec Generator');\n" +
      "assertSchema(spec, {\n" +
      "  type: 'object', required: ['ticket', 'grep', 'files'],\n" +
      "  props: {\n" +
      "    ticket: { type: 'string', enum: [key] },\n" +
      "    grep: { type: 'string', pattern: '^@' },\n" +
      "    files: { type: 'array', minItems: 1, items: FILE_SCHEMA },\n" +
      "    notes: { type: 'array', items: { type: 'string' } },\n" +
      "  },\n" +
      "}, 'Spec Generator');\n" +
      "assertFiles(spec.files, [`tests/e2e/${key.toLowerCase()}/`, 'tests/pages/', 'tests/fixtures/'], 'Spec Generator');\n" +
      "if (!spec.files.some((f) => f.path.endsWith('.spec.ts'))) throw new Error('[Spec Generator] no .spec.ts file returned');\n" +
      "if (!spec.files.filter((f) => f.path.endsWith('.spec.ts')).every((f) => f.content.includes(`@${key}`))) {\n" +
      "  throw new Error(`[Spec Generator] every spec must carry the @${key} tag`);\n" +
      "}\n" +
      "return [{ json: { ...ctx, spec } }];\n") } },
  output: [{ ticket: { key: 'PROJ-101' }, design: { has_endpoints: false, touches_db: false }, attempt: 0, review_feedback: [], spec: { grep: '@PROJ-101', files: [] } }]
});

const hasEndpoints = ifElse({
  version: 2.3,
  config: {
    name: 'Has Endpoints?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.design.has_endpoints }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const apiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · API (t=0.2)',
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0.2, maxTokensToSample: 12000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const apiAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'API Test Generator Agent',
    parameters: {
      promptType: 'define',
      text: expr('Generate Playwright API tests for the endpoints of this ticket. Return STRICT JSON per the runtime contract.\n\nTICKET KEY: {{ $json.ticket.key }}\nMODULE: {{ $json.design.module }}\nENDPOINTS:\n{{ JSON.stringify($json.design.endpoints, null, 2) }}\n\nAPI-RELATED MATRIX ROWS:\n{{ JSON.stringify($json.design.test_matrix.filter(r => (r.tags || []).includes("@api")), null, 2) }}\n\nreview_feedback:\n{{ JSON.stringify($json.review_feedback, null, 2) }}'),
      options: { systemMessage: "[PROMPT PENDING: prompts/api-test-generator.md \u2014 injected by update_workflow]", maxIterations: 3 }
    },
    subnodes: { model: apiModel }
  },
  output: [{ output: '{"files":[{"path":"tests/api/proj-101/coupon.api.spec.ts","content":"// @api"}],"endpoint_coverage":[{"method":"POST","path":"/api/coupons/apply","scenarios":["201"]}]}' }]
});

const validateApi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate API JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
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
      "const FILE_SCHEMA = { type: 'object', required: ['path', 'content'], props: { path: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } } };\n" +
      "function assertFiles(files, prefixes, label) {\n" +
      "  for (const f of files) {\n" +
      "    const p = f.path;\n" +
      "    if (p.includes('..') || p.startsWith('/') || p.includes('\\\\') || !prefixes.some((x) => p.startsWith(x))) throw new Error(`[${label}] path not allowed: \"${p}\" (allowed: ${prefixes.join(', ')})`);\n" +
      "    if (!p.endsWith('.ts')) throw new Error(`[${label}] only .ts files allowed: \"${p}\"`);\n" +
      "    if (/waitForTimeout\\s*\\(|setTimeout\\s*\\(/.test(f.content)) throw new Error(`[${label}] hard sleep found in ${p}`);\n" +
      "  }\n" +
      "  return files;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ctx = $('Has Endpoints?').last().json;\n" +
      "const key = ctx.ticket.key;\n" +
      "const api = parseAgentJson($input.first().json.output, 'API Test Generator');\n" +
      "assertSchema(api, {\n" +
      "  type: 'object', required: ['files', 'endpoint_coverage'],\n" +
      "  props: {\n" +
      "    files: { type: 'array', minItems: 1, items: FILE_SCHEMA },\n" +
      "    endpoint_coverage: { type: 'array', minItems: 1, items: { type: 'object', required: ['method', 'path', 'scenarios'], props: { scenarios: { type: 'array', minItems: 1, items: { type: 'string' } } } } },\n" +
      "  },\n" +
      "}, 'API Test Generator');\n" +
      "assertFiles(api.files, [`tests/api/${key.toLowerCase()}/`, 'tests/fixtures/'], 'API Test Generator');\n" +
      "return [{ json: { ...ctx, api } }];\n") } },
  output: [{ ticket: { key: 'PROJ-101' }, design: { touches_db: false }, spec: { files: [] }, api: { files: [] } }]
});

const noApi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'No API Tests', parameters: { mode: 'runOnceForAllItems', jsCode: 'return [{ json: { ...$input.first().json, api: null } }];' } },
  output: [{ ticket: { key: 'PROJ-101' }, design: { touches_db: false }, spec: { files: [] }, api: null }]
});

const touchesDb = ifElse({
  version: 2.3,
  config: {
    name: 'Touches DB?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.design.touches_db }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const dataModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Data (t=0.2)',
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0.2, maxTokensToSample: 8000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const dataAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Data Checks Agent',
    parameters: {
      promptType: 'define',
      text: expr('Generate read-only data-integrity checks for this ticket. Return STRICT JSON per the runtime contract.\n\nTICKET:\n{{ JSON.stringify($json.ticket, null, 2) }}\nMODULE: {{ $json.design.module }}\nDB ENTITIES: {{ JSON.stringify($json.design.db_entities) }}\n\nreview_feedback:\n{{ JSON.stringify($json.review_feedback, null, 2) }}'),
      options: { systemMessage: "[PROMPT PENDING: prompts/data-checks.md \u2014 injected by update_workflow]", maxIterations: 3 }
    },
    subnodes: { model: dataModel }
  },
  output: [{ output: '{"dialect":"postgresql","checks":[{"name":"no_orphans","severity":"critical","sql":"SELECT 1"}],"files":[{"path":"tests/data/proj-101/coupon.data.spec.ts","content":"// @data"}]}' }]
});

const validateData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Data JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
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
      "const FILE_SCHEMA = { type: 'object', required: ['path', 'content'], props: { path: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } } };\n" +
      "function assertFiles(files, prefixes, label) {\n" +
      "  for (const f of files) {\n" +
      "    const p = f.path;\n" +
      "    if (p.includes('..') || p.startsWith('/') || p.includes('\\\\') || !prefixes.some((x) => p.startsWith(x))) throw new Error(`[${label}] path not allowed: \"${p}\" (allowed: ${prefixes.join(', ')})`);\n" +
      "    if (!p.endsWith('.ts')) throw new Error(`[${label}] only .ts files allowed: \"${p}\"`);\n" +
      "    if (/waitForTimeout\\s*\\(|setTimeout\\s*\\(/.test(f.content)) throw new Error(`[${label}] hard sleep found in ${p}`);\n" +
      "  }\n" +
      "  return files;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ctx = $('Touches DB?').last().json;\n" +
      "const key = ctx.ticket.key;\n" +
      "const data = parseAgentJson($input.first().json.output, 'Data Checks');\n" +
      "assertSchema(data, {\n" +
      "  type: 'object', required: ['dialect', 'checks', 'files'],\n" +
      "  props: {\n" +
      "    dialect: { type: 'string' },\n" +
      "    checks: { type: 'array', minItems: 1, items: { type: 'object', required: ['name', 'severity', 'sql'], props: { severity: { type: 'string', enum: ['critical', 'warning', 'info'] }, sql: { type: 'string' } } } },\n" +
      "    files: { type: 'array', minItems: 1, items: FILE_SCHEMA },\n" +
      "  },\n" +
      "}, 'Data Checks');\n" +
      "for (const c of data.checks) {\n" +
      "  if (!/^\\s*(with|select)\\b/i.test(c.sql) || /\\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\\b/i.test(c.sql)) {\n" +
      "    throw new Error(`[Data Checks] check \"${c.name}\" is not read-only SQL`);\n" +
      "  }\n" +
      "}\n" +
      "assertFiles(data.files, [`tests/data/${key.toLowerCase()}/`, 'tests/fixtures/'], 'Data Checks');\n" +
      "return [{ json: { ...ctx, data } }];\n") } },
  output: [{ ticket: { key: 'PROJ-101' }, spec: { files: [] }, api: null, data: { files: [] } }]
});

const noData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'No Data Checks', parameters: { mode: 'runOnceForAllItems', jsCode: 'return [{ json: { ...$input.first().json, data: null } }];' } },
  output: [{ ticket: { key: 'PROJ-101' }, spec: { files: [] }, api: null, data: null }]
});

const assembleReview = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Assemble Review Bundle', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Merge generated files (later sources win on identical paths) for the review gate.\n" +
      "const ctx = $input.first().json;\n" +
      "const byPath = new Map();\n" +
      "for (const f of [...ctx.spec.files, ...(ctx.api?.files || []), ...(ctx.data?.files || [])]) byPath.set(f.path, f);\n" +
      "const all_files = [...byPath.values()];\n" +
      "return [{ json: { ...ctx, all_files } }];\n") } },
  output: [{ ticket: { key: 'PROJ-101' }, design: { test_matrix: [] }, attempt: 0, all_files: [{ path: 'tests/e2e/proj-101/coupon.spec.ts', content: '// @PROJ-101' }] }]
});

const reviewModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: {
    name: 'Claude · Review (t=0)',
    parameters: { model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' }, options: { temperature: 0, maxTokensToSample: 8000 } },
    credentials: { anthropicApi: newCredential('Anthropic (ANTHROPIC_API_KEY)') }
  }
});

const reviewAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Code Review Agent',
    parameters: {
      promptType: 'define',
      text: expr('Review this generated test code as the merge gate. Return STRICT JSON per the runtime contract.\n\nTICKET: {{ $json.ticket.key }} — {{ $json.ticket.summary }}\nMODULE TAG: @{{ $json.design.module }}\n\nTEST MATRIX (every row needs a spec):\n{{ JSON.stringify($json.design.test_matrix, null, 2) }}\n\nFILES:\n{{ $json.all_files.map(f => "=== " + f.path + " ===\\n" + f.content).join("\\n\\n") }}'),
      options: { systemMessage: "[PROMPT PENDING: prompts/code-review.md \u2014 injected by update_workflow]", maxIterations: 3 }
    },
    subnodes: { model: reviewModel }
  },
  output: [{ output: '{"verdict":"APPROVE","summary":"Solid POM usage.","issues":[],"good":["web-first assertions"]}' }]
});

const validateReview = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Review JSON', parameters: { mode: 'runOnceForAllItems', jsCode: ("// shared strict-JSON helpers (prepended by n8n/build.py)\n" +
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
      "const FILE_SCHEMA = { type: 'object', required: ['path', 'content'], props: { path: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } } };\n" +
      "function assertFiles(files, prefixes, label) {\n" +
      "  for (const f of files) {\n" +
      "    const p = f.path;\n" +
      "    if (p.includes('..') || p.startsWith('/') || p.includes('\\\\') || !prefixes.some((x) => p.startsWith(x))) throw new Error(`[${label}] path not allowed: \"${p}\" (allowed: ${prefixes.join(', ')})`);\n" +
      "    if (!p.endsWith('.ts')) throw new Error(`[${label}] only .ts files allowed: \"${p}\"`);\n" +
      "    if (/waitForTimeout\\s*\\(|setTimeout\\s*\\(/.test(f.content)) throw new Error(`[${label}] hard sleep found in ${p}`);\n" +
      "  }\n" +
      "  return files;\n" +
      "}\n" +
      "// end shared helpers\n" +
      "\n" +
      "const ctx = $('Assemble Review Bundle').last().json;\n" +
      "const review = parseAgentJson($input.first().json.output, 'Code Review');\n" +
      "assertSchema(review, {\n" +
      "  type: 'object', required: ['verdict', 'summary', 'issues'],\n" +
      "  props: {\n" +
      "    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },\n" +
      "    summary: { type: 'string', minLength: 1 },\n" +
      "    issues: { type: 'array', items: { type: 'object', required: ['severity', 'problem'], props: { severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] }, problem: { type: 'string' } } } },\n" +
      "    good: { type: 'array', items: { type: 'string' } },\n" +
      "  },\n" +
      "}, 'Code Review');\n" +
      "if (review.verdict === 'CHANGES' && !review.issues.some((i) => ['critical', 'major'].includes(i.severity))) {\n" +
      "  throw new Error('[Code Review] verdict CHANGES requires at least one critical/major issue');\n" +
      "}\n" +
      "const MAX_REVISIONS = 2;\n" +
      "return [{ json: { ...ctx, review, can_retry: review.verdict === 'CHANGES' && ctx.attempt < MAX_REVISIONS } }];\n") } },
  output: [{ ticket: { key: 'PROJ-101' }, attempt: 0, review: { verdict: 'APPROVE', summary: 'ok', issues: [] }, can_retry: false }]
});

const reviseSpecs = ifElse({
  version: 2.3,
  config: {
    name: 'Changes Requested & Retries Left?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.can_retry }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const prepareRevision = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Prepare Spec Revision', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $input.first().json;\n" +
      "return [{\n" +
      "  json: {\n" +
      "    ticket: ctx.ticket,\n" +
      "    design: ctx.design,\n" +
      "    attempt: ctx.attempt + 1,\n" +
      "    review_feedback: ctx.review.issues.filter((i) => i.severity !== 'nit'),\n" +
      "  },\n" +
      "}];\n") } },
  output: [{ ticket: { key: 'PROJ-101' }, design: {}, attempt: 1, review_feedback: [{ severity: 'major', problem: 'missing tag' }] }]
});

const buildPr = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build PR Payload', parameters: { mode: 'runOnceForAllItems', jsCode: ("const ctx = $input.first().json;\n" +
      "const cfg = $('Config').first().json;\n" +
      "const key = ctx.ticket.key;\n" +
      "const branch = `qa/${key}`;\n" +
      "const dispatch_id = `${key}-${$execution.id}-${Date.now()}`;\n" +
      "const cell = (v) => String(v ?? '').replace(/\\|/g, '\\\\|').replace(/\\r?\\n/g, '<br>');\n" +
      "const matrix = [\n" +
      "  '| ID | Title | Priority | Type | Expected | Tags |',\n" +
      "  '|---|---|---|---|---|---|',\n" +
      "  ...ctx.design.test_matrix.map((r) => `| ${cell(r.id)} | ${cell(r.title)} | ${cell(r.priority)} | ${cell(r.type)} | ${cell(r.expected)} | ${cell((r.tags || []).join(' '))} |`),\n" +
      "].join('\\n');\n" +
      "const verdict = ctx.review.verdict;\n" +
      "const issues = ctx.review.issues.length\n" +
      "  ? ctx.review.issues.map((i) => `- **${i.severity}** ${i.file ? '`' + i.file + (i.line ? ':' + i.line : '') + '`' : ''} ${i.problem}${i.fix ? ' \u2192 ' + i.fix : ''}`).join('\\n')\n" +
      "  : '_none_';\n" +
      "const warn = verdict === 'CHANGES'\n" +
      "  ? `> [!WARNING]\\n> Review gate still returned **CHANGES** after ${ctx.attempt} revision(s). Human attention required before this PR is used.\\n\\n`\n" +
      "  : '';\n" +
      "const body = `${warn}## ${key} \u2014 ${ctx.ticket.summary}\\n\\nJira: ${ctx.ticket.url}\\nModule: \\`@${ctx.design.module}\\` \u00b7 Grep: \\`${ctx.spec.grep}\\`\\n\\n` +\n" +
      "  `### Test matrix\\n${matrix}\\n\\n` +\n" +
      "  `### Review verdict: \\`${verdict}\\` (revisions: ${ctx.attempt})\\n${ctx.review.summary}\\n\\n${issues}\\n\\n` +\n" +
      "  `### Files\\n${ctx.all_files.map((f) => '- `' + f.path + '`').join('\\n')}\\n\\n` +\n" +
      "  (ctx.design.assumptions.length ? `### Assumptions\\n${ctx.design.assumptions.map((a) => '- ' + a).join('\\n')}\\n\\n` : '') +\n" +
      "  `---\\nGenerated by n8n **QA | Design & Automate** (execution ${$execution.id}). Never auto-merged \u2014 a human approves and merges.`;\n" +
      "return [{\n" +
      "  json: {\n" +
      "    ...ctx,\n" +
      "    branch,\n" +
      "    dispatch_id,\n" +
      "    grep: ctx.spec.grep,\n" +
      "    commit_message: `test(${key}): add generated Playwright tests\\n\\nReview verdict: ${verdict}\\nSource: n8n execution ${$execution.id}`,\n" +
      "    pr_title: `[QA] ${key}: automated tests \u2014 ${ctx.ticket.summary}`.slice(0, 250),\n" +
      "    pr_body: body,\n" +
      "    tree: ctx.all_files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),\n" +
      "    pr_draft: cfg.PR_DRAFT === true || cfg.PR_DRAFT === 'true',\n" +
      "  },\n" +
      "}];\n") } },
  output: [{ ticket: { key: 'PROJ-101', summary: 'Apply coupon at checkout', url: 'https://example.atlassian.net/browse/PROJ-101' }, design: { module: 'checkout' }, review: { verdict: 'APPROVE' }, branch: 'qa/PROJ-101', dispatch_id: 'PROJ-101-1-1700000000000', grep: '@PROJ-101', commit_message: 'test(PROJ-101): add generated Playwright tests', pr_title: '[QA] PROJ-101: automated tests', pr_body: '## PROJ-101', tree: [{ path: 'tests/e2e/proj-101/coupon.spec.ts', mode: '100644', type: 'blob', content: '// x' }], pr_draft: true }]
});

const getBaseBranch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Get Base Branch',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/branches/{{ $("Config").first().json.BASE_BRANCH }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ name: 'main', commit: { sha: 'aaa111', commit: { tree: { sha: 'tree111' } } } }]
});

const createTree = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Create Tree',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/git/trees'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ base_tree: $json.commit.commit.tree.sha, tree: $("Build PR Payload").last().json.tree }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ sha: 'tree222' }]
});

const createCommit = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Create Commit',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/git/commits'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ message: $("Build PR Payload").last().json.commit_message, tree: $json.sha, parents: [$("GitHub · Get Base Branch").last().json.commit.sha] }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ sha: 'commit333' }]
});

const createBranch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Create Branch qa/KEY',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/git/refs'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ ref: "refs/heads/" + $("Build PR Payload").last().json.branch, sha: $json.sha }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ ref: 'refs/heads/qa/PROJ-101', object: { sha: 'commit333' } }]
});

const forceUpdateBranch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Update Existing qa/KEY Branch',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'PATCH',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/git/refs/heads/{{ $("Build PR Payload").last().json.branch }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ sha: $("GitHub · Create Commit").last().json.sha, force: true }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ ref: 'refs/heads/qa/PROJ-101', object: { sha: 'commit333' } }]
});

const openPr = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Open Pull Request',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/pulls'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ title: $("Build PR Payload").last().json.pr_title, head: $("Build PR Payload").last().json.branch, base: $("Config").first().json.BASE_BRANCH, body: $("Build PR Payload").last().json.pr_body, draft: $("Build PR Payload").last().json.pr_draft, maintainer_can_modify: true }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ number: 42, html_url: 'https://github.com/acme/webapp/pull/42' }]
});

const findExistingPr = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Find Existing PR',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/pulls?state=open&head={{ $("Config").first().json.GITHUB_OWNER }}:{{ encodeURIComponent($("Build PR Payload").last().json.branch) }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ number: 42, html_url: 'https://github.com/acme/webapp/pull/42' }]
});

const prInfo = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'PR Info',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'pr-url', name: 'pr_url', value: expr('{{ $json.html_url }}'), type: 'string' },
          { id: 'pr-number', name: 'pr_number', value: expr('{{ $json.number }}'), type: 'number' },
          { id: 'pr-ticket', name: 'ticket', value: expr('{{ $("Build PR Payload").last().json.ticket.key }}'), type: 'string' },
          { id: 'pr-branch', name: 'branch', value: expr('{{ $("Build PR Payload").last().json.branch }}'), type: 'string' },
          { id: 'pr-verdict', name: 'review_verdict', value: expr('{{ $("Build PR Payload").last().json.review.verdict }}'), type: 'string' }
        ]
      }
    }
  },
  output: [{ pr_url: 'https://github.com/acme/webapp/pull/42', pr_number: 42, ticket: 'PROJ-101', branch: 'qa/PROJ-101', review_verdict: 'APPROVE' }]
});

const approval = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Slack · Approve Test PR',
    parameters: {
      resource: 'message',
      operation: 'sendAndWait',
      authentication: 'accessToken',
      select: 'channel',
      channelId: { __rl: true, mode: 'name', value: expr('{{ $("Config").first().json.SLACK_CHANNEL }}') },
      message: expr(':test_tube: *Approve test PR* for *{{ $json.ticket }}* — {{ $("Build PR Payload").last().json.ticket.summary }}\nPR: {{ $json.pr_url }}\nReview gate: *{{ $json.review_verdict }}* · {{ $("Build PR Payload").last().json.design.test_matrix.length }} test cases · {{ $("Build PR Payload").last().json.all_files.length }} files\nApproving dispatches `qa-pr.yml` on `{{ $json.branch }}` (grep `{{ $("Build PR Payload").last().json.grep }}`). The PR is never auto-merged.'),
      responseType: 'approval',
      approvalOptions: { values: { approvalType: 'double', approveLabel: 'Approve & run CI', disapproveLabel: 'Decline' } },
      options: { limitWaitTime: { values: { limitType: 'afterTimeInterval', resumeAmount: 24, resumeUnit: 'hours' } } }
    },
    credentials: { slackApi: newCredential('Slack Bot (SLACK_CHANNEL)') }
  },
  output: [{ data: { approved: true, respondedAt: '2026-10-16T10:00:00Z' } }]
});

const isApproved = ifElse({
  version: 2.3,
  config: {
    name: 'Approved?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.data?.approved === true }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const dispatchCi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Dispatch qa-pr.yml',
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
      jsonBody: expr('{{ JSON.stringify({ ref: $("PR Info").last().json.branch, inputs: { ticket: $("PR Info").last().json.ticket, branch: $("PR Info").last().json.branch, grep: $("Build PR Payload").last().json.grep, dispatch_id: $("Build PR Payload").last().json.dispatch_id, repeat_each: "0", projects: "chromium" } }) }}')
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{}]
});

const waitForRun = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: { name: 'Wait 20s for Run to Register', parameters: { resume: 'timeInterval', amount: 20, unit: 'seconds' } },
  output: [{}]
});

const findRun = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub · Find Dispatched Run',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $("Config").first().json.GITHUB_OWNER }}/{{ $("Config").first().json.GITHUB_REPO }}/actions/workflows/qa-pr.yml/runs?event=workflow_dispatch&per_page=20&branch={{ encodeURIComponent($("PR Info").last().json.branch) }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { timeout: 60000 },
    },
    credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }
  },
  output: [{ total_count: 1, workflow_runs: [{ id: 987654321, display_title: 'qa-pr PROJ-101 [PROJ-101-1-1700000000000]', html_url: 'https://github.com/acme/webapp/actions/runs/987654321' }] }]
});

const pickRun = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick Run ID', parameters: { mode: 'runOnceForAllItems', jsCode: ("// Find the run we just dispatched by the dispatch_id embedded in qa-pr.yml's run-name.\n" +
      "const ctx = $('Build PR Payload').last().json;\n" +
      "const runs = $input.first().json.workflow_runs || [];\n" +
      "const run = runs.find((r) => (r.display_title || r.name || '').includes(ctx.dispatch_id));\n" +
      "return [{ json: { run_id: run ? String(run.id) : '', run_url: run ? run.html_url : '', run_found: !!run } }];\n") } },
  output: [{ run_id: '987654321', run_url: 'https://github.com/acme/webapp/actions/runs/987654321', run_found: true }]
});

const labelTicket = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Jira · Add Label qa-automated',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'PUT',
      url: expr('{{ $("Config").first().json.JIRA_BASE_URL.replace(/\\/$/, "") }}/rest/api/3/issue/{{ $("PR Info").last().json.ticket }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '{ "update": { "labels": [ { "add": "qa-automated" } ] } }',
      options: { timeout: 60000 }
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{}]
});

const commentTicket = node({
  type: 'n8n-nodes-base.jira',
  version: 1,
  config: {
    name: 'Jira · Comment PR Link',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      jiraVersion: 'cloud',
      resource: 'issueComment',
      operation: 'add',
      issueKey: expr('{{ $("PR Info").last().json.ticket }}'),
      comment: expr('QA automation: generated Playwright tests are ready for review.\nPR: {{ $("PR Info").last().json.pr_url }}\nReview gate: {{ $("PR Info").last().json.review_verdict }}\nCI run (qa-pr.yml): {{ $("Pick Run ID").last().json.run_url || "dispatched — run link pending" }}\nBranch: {{ $("PR Info").last().json.branch }}')
    },
    credentials: { jiraSoftwareCloudApi: newCredential('Jira (JIRA_EMAIL + JIRA_API_TOKEN)') }
  },
  output: [{ id: '10001' }]
});

const recordRun = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Record Dispatched Run',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $("PR Info").last().json.ticket }}'),
          branch: expr('{{ $("PR Info").last().json.branch }}'),
          pr_url: expr('{{ $("PR Info").last().json.pr_url }}'),
          run_id: expr('{{ $("Pick Run ID").last().json.run_id }}'),
          status: 'ci_dispatched',
          kind: 'design',
          dispatch_id: expr('{{ $("Build PR Payload").last().json.dispatch_id }}'),
          review_verdict: expr('{{ $("PR Info").last().json.review_verdict }}'),
          module: expr('{{ $("Build PR Payload").last().json.design.module }}')
        },
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
      }
    }
  },
  output: [{ id: 1 }]
});

const recordDeclined = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'qa_runs · Record Declined',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: '9mMnRlpTU4S4ezRU', cachedResultName: 'qa_runs' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ticket: expr('{{ $("PR Info").last().json.ticket }}'),
          branch: expr('{{ $("PR Info").last().json.branch }}'),
          pr_url: expr('{{ $("PR Info").last().json.pr_url }}'),
          run_id: '',
          status: 'declined_or_timed_out',
          kind: 'design',
          dispatch_id: expr('{{ $("Build PR Payload").last().json.dispatch_id }}'),
          review_verdict: expr('{{ $("PR Info").last().json.review_verdict }}'),
          module: expr('{{ $("Build PR Payload").last().json.design.module }}')
        },
        schema: [{ id: 'ticket', displayName: 'ticket', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'branch', displayName: 'branch', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'pr_url', displayName: 'pr_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'dispatch_id', displayName: 'dispatch_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'conclusion', displayName: 'conclusion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'merge_decision', displayName: 'merge_decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'review_verdict', displayName: 'review_verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'module', displayName: 'module', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
      }
    }
  },
  output: [{ id: 2 }]
});

const nextTicket = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Next Ticket' },
  output: [{}]
});

const note = sticky('## QA | Design & Automate (WF1)\nSOP stages: **Design → Automate → Review → Run in CI**.\n1. Jira JQL (Config.JIRA_PROJECT) → skip tickets already in `qa_runs`.\n2. Per ticket: Test Design → Spec Generator → API/Data agents (only if relevant) → Code Review. `CHANGES` loops back to Spec Generator at most 2×.\n3. Commit to `qa/<KEY>` (Git Data API), open **draft** PR, ask Slack for approval.\n4. Approved → dispatch `qa-pr.yml` {ticket, branch, grep}, label Jira `qa-automated`, comment, record in `qa_runs`.\nEvery agent output is strictly schema-validated in a Code node (fail fast → WF4). Never auto-merges.', [], { color: 4 });

export default workflow('qa-design-automate', 'QA | Design & Automate')
  .add(note)
  .add(manualRun)
  .to(config)
  .add(every2h)
  .to(config)
  .add(config)
  .to(searchTickets)
  .to(normalizeTickets)
  .to(skipProcessed)
  .to(loopTickets.onEachBatch(
    currentTicket
      .to(testDesignAgent)
      .to(validateDesign)
      .to(specContext)
      .to(specAgent)
      .to(validateSpec)
      .to(hasEndpoints
        .onTrue(apiAgent.to(validateApi).to(touchesDb))
        .onFalse(noApi.to(touchesDb)))
  ))
  .add(touchesDb
    .onTrue(dataAgent.to(validateData).to(assembleReview))
    .onFalse(noData.to(assembleReview)))
  .add(assembleReview)
  .to(reviewAgent)
  .to(validateReview)
  .to(reviseSpecs
    .onTrue(prepareRevision.to(specContext))
    .onFalse(buildPr))
  .add(buildPr)
  .to(getBaseBranch)
  .to(createTree)
  .to(createCommit)
  .to(createBranch)
  .to(openPr)
  .add(createBranch.onError(forceUpdateBranch.to(openPr)))
  .add(openPr)
  .to(prInfo)
  .add(openPr.onError(findExistingPr.to(prInfo)))
  .add(prInfo)
  .to(approval)
  .to(isApproved
    .onTrue(dispatchCi.to(waitForRun).to(findRun).to(pickRun).to(labelTicket).to(commentTicket).to(recordRun).to(nextTicket))
    .onFalse(recordDeclined.to(nextTicket)))
  .add(nextTicket)
  .to(nextBatch(loopTickets));
