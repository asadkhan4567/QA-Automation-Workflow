const ctx = $('Triage Input').last().json;
const triage = parseAgentJson($input.first().json.output, 'Triage');
const CATS = ['ProductBug', 'TestBug', 'Flaky', 'Environment', 'TestData', 'KnownIssue'];
assertSchema(triage, {
  type: 'object', required: ['run_id', 'total', 'failed', 'merge_decision', 'issues'],
  props: {
    merge_decision: { type: 'string', enum: ['BLOCK', 'ALLOW_AFTER_FIX', 'ALLOW'] },
    total: { type: 'number', min: 0 }, failed: { type: 'number', min: 0 },
    issues: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['signature', 'category', 'confidence', 'tests', 'evidence', 'action'],
        props: {
          category: { type: 'string', enum: CATS },
          confidence: { type: 'number', min: 0, max: 1 },
          tests: { type: 'array', minItems: 1, items: { type: 'object', required: ['title'] } },
          evidence: { type: 'string', minLength: 1 },
          known_issue_key: { type: 'string', nullable: true },
        },
      },
    },
  },
}, 'Triage');
// Skill rule: never Flaky if it failed on every retry.
for (const iss of triage.issues) {
  if (iss.category === 'Flaky') {
    const hits = ctx.failures.filter((f) => iss.tests.some((t) => t.title === f.title));
    if (hits.length && hits.every((f) => f.failed_all_retries)) { iss.category = 'TestBug'; iss.confidence = Math.min(iss.confidence, 0.6); iss.evidence += ' [auto-corrected: failed on every retry, cannot be Flaky]'; }
  }
  iss.route = iss.confidence < 0.7 ? 'review'
    : iss.category === 'ProductBug' ? 'product_bug'
    : ['Flaky', 'TestBug', 'TestData'].includes(iss.category) ? 'task'
    : iss.category === 'Environment' ? 'environment'
    : iss.category === 'KnownIssue' && iss.known_issue_key ? 'known_issue' : 'review';
}
// Deterministic merge decision (SOP Stage 5, step 6) — the agent's value is kept for audit.
const routes = triage.issues.map((i) => i.route);
const merge = routes.some((r) => ['product_bug', 'review', 'known_issue'].includes(r)) ? 'BLOCK'
  : routes.some((r) => r === 'task') ? 'ALLOW_AFTER_FIX'
  : 'ALLOW';
return [{ json: { ...ctx, triage, merge_decision: merge, agent_merge_decision: triage.merge_decision } }];
