// The job failed before Playwright wrote results.json (install, checkout, runner, secrets...).
const ctx = $('Pick results-json Artifact').first().json;
return [{ json: { ...ctx, total: 0, failed: 1, stats: {}, truncated: false, failures: [{ title: '(no results.json — job failed before tests ran)', file: '', project: '', outcome: 'unexpected', attempts: [], passed_on_retry: false, failed_all_retries: true, error: `No results-json artifact on run ${ctx.run_id}. See ${ctx.run_url}`, location: '', duration_ms: 0, attachments: [] }] } }];
