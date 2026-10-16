// Unzip the results-json artifact and flatten Playwright JSON-reporter output into failures.
const ctx = $('Pick results-json Artifact').first().json;
const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
const files = unzip(buf);
const name = Object.keys(files).find((n) => /results\.json$/.test(n));
if (!name) throw new Error(`results.json not found in artifact (entries: ${Object.keys(files).join(', ')})`);
const report = JSON.parse(new TextDecoder().decode(files[name]));
const failures = [];
let total = 0;
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const walk = (suite, filePath) => {
  const file = suite.file || filePath;
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      total += 1;
      const statuses = (t.results || []).map((r) => r.status);
      if (t.status === 'expected' || t.status === 'skipped') continue;
      const results = t.results || [];
      const last = results.slice(-1)[0] || {};
      const failedRun = [...results].reverse().find((r) => r.status !== 'passed') || last;
      const err = (failedRun.errors && failedRun.errors[0]) || failedRun.error || {};
      failures.push({
        title: spec.title,
        file: `${file}:${spec.line || ''}`,
        project: t.projectName,
        outcome: t.status,
        attempts: statuses,
        passed_on_retry: t.status === 'flaky',
        failed_all_retries: statuses.length > 0 && statuses.every((s) => s !== 'passed'),
        error: strip(err.message).slice(0, 1500),
        location: err.location ? `${err.location.file}:${err.location.line}` : '',
        duration_ms: (t.results || []).reduce((a, r) => a + (r.duration || 0), 0),
        attachments: (failedRun.attachments || []).map((x) => x.name),
      });
    }
  }
  for (const s of suite.suites || []) walk(s, file);
};
for (const s of report.suites || []) walk(s, s.file);
const stats = report.stats || {};
return [{ json: { ...ctx, total, failed: failures.length, stats, failures: failures.slice(0, 60), truncated: failures.length > 60 } }];
