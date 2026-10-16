const ctx = $input.first().json;
return ctx.triage.issues.map((issue, idx) => ({
  json: {
    idx: idx + 1, issue, route: issue.route,
    ticket: ctx.ticket, run_id: ctx.run_id, run_url: ctx.run_url, run_attempt: ctx.run_attempt,
    head_sha: ctx.head_sha, branch: ctx.branch, module: issue.module || ctx.module, pr_url: ctx.pr_url,
    failures: ctx.failures.filter((f) => issue.tests.some((t) => t.title === f.title)),
  },
}));
