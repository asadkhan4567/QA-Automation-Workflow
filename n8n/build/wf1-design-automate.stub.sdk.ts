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
  config: { name: 'Normalize Tickets', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub normalize-tickets" } },
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
      options: { systemMessage: "[stub prompt: test-design]", maxIterations: 3 }
    },
    subnodes: { model: designModel }
  },
  output: [{ output: '{"ticket":"PROJ-101","module":"checkout","has_endpoints":false,"endpoints":[],"touches_db":false,"db_entities":[],"assumptions":[],"gherkin":"Feature: Coupon","test_matrix":[{"id":"TC-01","title":"valid coupon","priority":"P0","type":"Positive","steps":["apply"],"expected":"total reduced","tags":["@PROJ-101","@checkout","@smoke"]}]}' }]
});

const validateDesign = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Test Design JSON', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub validate-test-design" } },
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
      options: { systemMessage: "[stub prompt: spec-generator]", maxIterations: 3 }
    },
    subnodes: { model: specModel }
  },
  output: [{ output: '{"ticket":"PROJ-101","grep":"@PROJ-101","files":[{"path":"tests/e2e/proj-101/coupon.spec.ts","content":"// @PROJ-101"}],"notes":[]}' }]
});

const validateSpec = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Spec JSON', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub validate-spec" } },
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
      options: { systemMessage: "[stub prompt: api-test-generator]", maxIterations: 3 }
    },
    subnodes: { model: apiModel }
  },
  output: [{ output: '{"files":[{"path":"tests/api/proj-101/coupon.api.spec.ts","content":"// @api"}],"endpoint_coverage":[{"method":"POST","path":"/api/coupons/apply","scenarios":["201"]}]}' }]
});

const validateApi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate API JSON', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub validate-api" } },
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
      options: { systemMessage: "[stub prompt: data-checks]", maxIterations: 3 }
    },
    subnodes: { model: dataModel }
  },
  output: [{ output: '{"dialect":"postgresql","checks":[{"name":"no_orphans","severity":"critical","sql":"SELECT 1"}],"files":[{"path":"tests/data/proj-101/coupon.data.spec.ts","content":"// @data"}]}' }]
});

const validateData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Data JSON', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub validate-data" } },
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
  config: { name: 'Assemble Review Bundle', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub assemble-review" } },
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
      options: { systemMessage: "[stub prompt: code-review]", maxIterations: 3 }
    },
    subnodes: { model: reviewModel }
  },
  output: [{ output: '{"verdict":"APPROVE","summary":"Solid POM usage.","issues":[],"good":["web-first assertions"]}' }]
});

const validateReview = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Validate Review JSON', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub validate-review" } },
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
  config: { name: 'Prepare Spec Revision', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub prepare-revision" } },
  output: [{ ticket: { key: 'PROJ-101' }, design: {}, attempt: 1, review_feedback: [{ severity: 'major', problem: 'missing tag' }] }]
});

const buildPr = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build PR Payload', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub build-pr" } },
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
  config: { name: 'Pick Run ID', parameters: { mode: 'runOnceForAllItems', jsCode: "return $input.all(); // stub pick-run" } },
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
