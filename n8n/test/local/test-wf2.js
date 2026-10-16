const run = require('./harness.js');
const crypto = require('crypto'); const fs = require('fs'); const C = process.argv[2];
(async () => {
  const payload = JSON.stringify({ action: 'completed', workflow: { path: '.github/workflows/qa-pr.yml' }, repository: { full_name: 'acme/webapp' },
    workflow_run: { id: 11873402211, run_attempt: 1, conclusion: 'failure', html_url: 'https://github.com/acme/webapp/actions/runs/11873402211', artifacts_url: 'https://api.github.com/repos/acme/webapp/actions/runs/11873402211/artifacts', head_branch: 'qa/PROJ-101', head_sha: 'c0ffee1234abcd', event: 'workflow_dispatch', display_title: 'qa-pr PROJ-101 [PROJ-101-616-1792180312375]', path: '.github/workflows/qa-pr.yml' } });
  const secret = 's3cr3t';
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const mk = (s) => ({ nodes: { Config: [{ json: { GITHUB_WEBHOOK_SECRET: secret, GITHUB_OWNER: 'acme', GITHUB_REPO: 'webapp' } }] }, input: [{ json: { headers: { 'x-github-event': 'workflow_run', 'x-hub-signature-256': s, 'x-github-delivery': 'abc' } }, binary: { data: {} } }], binary: Buffer.from(payload) });
  console.log('valid sig ->', JSON.stringify(await run(C + '/verify-signature.js', mk(sig))));
  try { await run(C + '/verify-signature.js', mk(sig.slice(0, 20) + (sig[20] === 'a' ? 'b' : 'a') + sig.slice(21))); console.log('tampered: ACCEPTED (BAD)'); } catch (e) { console.log('tampered ->', e.message); }
  try { await run(C + '/verify-signature.js', mk('')); console.log('missing: ACCEPTED (BAD)'); } catch (e) { console.log('missing ->', e.message); }
  // parse-results with a Playwright-shaped report zipped by python
  const zip = fs.readFileSync('pw.zip');
  const unzipSrc = fs.readFileSync(C + '/_unzip.js', 'utf8'); const pr = fs.readFileSync(C + '/parse-results.js', 'utf8');
  fs.writeFileSync('combined.js', unzipSrc + '\n' + pr);
  const out = await run('combined.js', { nodes: { 'Pick results-json Artifact': [{ json: { run_id: '1', ticket: 'PROJ-101' } }] }, binary: zip });
  console.log('parsed ->', JSON.stringify(out[0].json, null, 1));
})();
