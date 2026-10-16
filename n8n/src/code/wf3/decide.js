// Verification decision + Jira comment (fix-verification skill template). Never Closed: PASS -> Verified, FAIL -> Reopened.
const ctx = $input.first().json;
const pass = ctx.outcome === 'pass';
const today = $now.setZone('Asia/Karachi').toFormat('yyyy-MM-dd');
const comment = [
  `Verification — ${pass ? 'PASS' : 'FAIL'}`,
  `Build: ${ctx.plan.build} | Env: QA | Browser(s): ${ctx.projects.split(',').join(', ')}`,
  `Original steps: ${pass ? 'pass' : 'fail'}`,
  `Repeat runs: --repeat-each=${ctx.repeat_each} across ${ctx.projects.split(',').length} engines — ${pass ? 'all passed' : 'at least one failed'}`,
  `Regression (${ctx.grep}): ${pass ? 'passed' : 'failed'}`,
  `Regression test added: ${ctx.plan.regression_test_exists ? (ctx.plan.regression_test_hint || 'existing test') : 'NONE — add one tagged @regression ' + ctx.grep + ' with the bug ID in the title'}`,
  `Evidence: ${ctx.run_url || 'n/a'}`,
  '',
  pass ? 'Transitioning to Verified. A human QA must sign off and close — automation never closes tickets.' : 'Transitioning to Reopened with the evidence above; assigning back to development.',
].join('\n');
return [{ json: { ...ctx, verdict: pass ? 'PASS' : 'FAIL', target_statuses: pass ? ['Verified'] : ['Reopened', 'Reopen'], sheet_status: pass ? 'Verified' : 'Reopened', verified_date: pass ? today : '', comment } }];
