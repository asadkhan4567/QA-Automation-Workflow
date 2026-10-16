// Poll result written by WF2 into qa_runs (kind=verification).
const MAX_POLLS = 18; // 18 x 5 min = 90 min
const ctx = $('Wait for WF2 Result').last().json;
const row = $input.all().map((i) => i.json).find((r) => r && r.id !== undefined) || {};
const polls = (ctx.polls || 0) + 1;
const outcome = row.status === 'passed' ? 'pass' : row.status === 'failed' ? 'fail' : polls >= MAX_POLLS ? 'timeout' : 'pending';
const cfg = $('Config').first().json;
const run_url = row.run_id ? `https://github.com/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/runs/${row.run_id}` : '';
return [{ json: { ...ctx, polls, outcome, run_id: row.run_id || '', run_url, conclusion: row.conclusion || '' } }];
