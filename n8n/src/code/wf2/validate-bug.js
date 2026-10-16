const ctx = $('Route Issue').item.json;
const bug = parseAgentJson($input.item.json.output, 'Bug Report');
assertSchema(bug, {
  type: 'object',
  required: ['title', 'summary', 'severity', 'priority', 'rationale', 'module', 'environment', 'steps', 'reproduction_rate', 'expected', 'actual', 'evidence', 'hypothesis', 'markdown', 'sheet_row'],
  props: {
    title: { type: 'string', pattern: '^\\[BUG\\] ' },
    severity: { type: 'string', enum: ['S1', 'S2', 'S3', 'S4'] },
    priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
    steps: { type: 'array', minItems: 1, items: { type: 'string' } },
    evidence: { type: 'array', minItems: 1, items: { type: 'string' } },
    markdown: { type: 'string', minLength: 50 },
    sheet_row: { type: 'object', required: ['Title', 'Module', 'Severity', 'Priority', 'Status', 'Steps', 'Expected', 'Actual'] },
  },
}, 'Bug Report');
const jiraPriority = { P0: 'Highest', P1: 'High', P2: 'Medium', P3: 'Low' }[bug.priority];
return { json: { ...ctx, bug, jira_priority: jiraPriority } };
