// Merge the verified run with its qa_runs row (absent for manual / pull_request runs).
const run = $('Verify Signature & Filter').first().json;
const row = $input.all().map((i) => i.json).find((r) => r && r.id !== undefined) || {};
return [{ json: { ...run, kind: row.kind || 'pr', module: row.module || '', pr_url: row.pr_url || '', branch: row.branch || run.head_branch, qa_row_found: !!row.id } }];
