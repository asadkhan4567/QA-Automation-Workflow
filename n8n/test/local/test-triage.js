const run = require('./harness.js');
const S = __dirname;
(async () => {
  const failures = [
    { title: 'TC-02 expired coupon shows error and keeps total @PROJ-101', project: 'chromium', attempts: ['failed','failed','failed'], failed_all_retries: true, error: 'Expected: "This coupon has expired" Received: "Coupon applied"' },
    { title: 'TC-04 second coupon is refused @PROJ-101', project: 'chromium', attempts: ['timedOut','passed'], failed_all_retries: false, error: 'Test timeout of 30000ms exceeded.' },
  ];
  const ctx = { run_id: '11873402211', run_attempt: 1, run_url: 'https://github.com/acme/webapp/actions/runs/11873402211', ticket: 'PROJ-101', module: 'checkout-coupon', head_sha: 'c0ffee1234', branch: 'qa/PROJ-101', pr_url: 'https://github.com/acme/webapp/pull/87', total: 18, failed: 2, failures, row_key: 'PROJ-101-616-1' };
  const agent = { run_id: '11873402211', total: 18, failed: 2, merge_decision: 'BLOCK', issues: [
    { signature: 'toHaveText expected "This coupon has expired" got "Coupon applied"', category: 'ProductBug', confidence: 0.88, module: 'checkout-coupon', tests: [{ title: failures[0].title, project: 'chromium' }], evidence: 'failed 3/3 attempts; coupon.spec.ts:13', hypothesis: 'Hypothesis: expiry check skipped in coupon service', action: 'File bug via bug-report-writer', known_issue_key: null },
    { signature: 'Test timeout of Nms exceeded', category: 'Flaky', confidence: 0.81, module: 'checkout-coupon', tests: [{ title: failures[1].title, project: 'chromium' }], evidence: 'timedOut then passed on retry 1', hypothesis: 'Hypothesis: slow cart recalculation', action: 'Tag @flaky, open task', known_issue_key: null },
    { signature: 'cart seed 503', category: 'Environment', confidence: 0.55, module: 'checkout-coupon', tests: [{ title: 'TC-07 API 200 valid code' }], evidence: '503 from /api/test-support/carts', action: 'Re-run', known_issue_key: null } ] };
  const v = await run(S + '/vt.js', { nodes: { 'Triage Input': [{ json: ctx }] }, input: [{ json: { output: '```json\n' + JSON.stringify(agent) + '\n```' } }] });
  const o = v[0].json;
  console.log('merge:', o.merge_decision, '| routes:', o.triage.issues.map(i => i.category + '->' + i.route).join(', '));
  const split = await run(process.argv[2] + '/wf2/split-issues.js', { input: v });
  console.log('split items:', split.length, split.map(s => s.json.route + ':' + s.json.failures.length));
  const sum = await run(process.argv[2] + '/wf2/slack-summary.js', { input: v });
  console.log(sum[0].json.slack_text);
  require('fs').writeFileSync(S + '/triage-sample.json', JSON.stringify({ agent, validated: o, slack: sum[0].json.slack_text }, null, 1));
})();
