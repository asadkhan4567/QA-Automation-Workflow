const ctx = $('Assemble Review Bundle').last().json;
const review = parseAgentJson($input.first().json.output, 'Code Review');
assertSchema(review, {
  type: 'object', required: ['verdict', 'summary', 'issues'],
  props: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    summary: { type: 'string', minLength: 1 },
    issues: { type: 'array', items: { type: 'object', required: ['severity', 'problem'], props: { severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] }, problem: { type: 'string' } } } },
    good: { type: 'array', items: { type: 'string' } },
  },
}, 'Code Review');
if (review.verdict === 'CHANGES' && !review.issues.some((i) => ['critical', 'major'].includes(i.severity))) {
  throw new Error('[Code Review] verdict CHANGES requires at least one critical/major issue');
}
const MAX_REVISIONS = 2;
return [{ json: { ...ctx, review, can_retry: review.verdict === 'CHANGES' && ctx.attempt < MAX_REVISIONS } }];
