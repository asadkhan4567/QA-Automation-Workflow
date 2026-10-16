// Verify GitHub's X-Hub-Signature-256 over the RAW request body, then keep only completed qa-pr.yml runs.
const crypto = require('crypto');
const cfg = $('Config').first().json;
const item = $input.first();
const headers = item.json.headers || {};
const secret = String(cfg.GITHUB_WEBHOOK_SECRET || '');
if (!secret || secret.startsWith('<SET_ME')) throw new Error('GITHUB_WEBHOOK_SECRET is not configured in Config');
if (!item.binary || !item.binary.data) throw new Error('Raw body missing — enable the Webhook option "Raw Body"');
const raw = await this.helpers.getBinaryDataBuffer(0, 'data');
const enc = new TextEncoder();
const expected = enc.encode('sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'));
const got = enc.encode(String(headers['x-hub-signature-256'] || ''));
if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
  throw new Error(`Invalid X-Hub-Signature-256 (delivery ${headers['x-github-delivery'] || 'n/a'}) — request rejected`);
}
const body = JSON.parse(new TextDecoder().decode(raw));
const event = headers['x-github-event'];
const run = body.workflow_run;
const path = String(body.workflow?.path || run?.path || '');
if (event !== 'workflow_run' || body.action !== 'completed' || !run || !/qa-pr\.ya?ml$/.test(path)) return [];
const title = String(run.display_title || run.name || '');
const m = title.match(/qa-pr\s+([A-Z][A-Z0-9]+-\d+)\s+\[([^\]]+)\]/);
const branchKey = String(run.head_branch || '').match(/^qa\/([A-Z][A-Z0-9]+-\d+)$/);
const ticket = m ? m[1] : branchKey ? branchKey[1] : '';
const dispatch_id = m ? m[2] : '';
return [{
  json: {
    run_id: String(run.id),
    run_attempt: run.run_attempt || 1,
    conclusion: run.conclusion,
    run_url: run.html_url,
    artifacts_url: run.artifacts_url,
    head_branch: run.head_branch,
    head_sha: run.head_sha,
    trigger_event: run.event,
    display_title: title,
    repo: body.repository?.full_name || `${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}`,
    ticket,
    dispatch_id,
    row_key: dispatch_id || `run-${run.id}`,
    delivery: headers['x-github-delivery'] || '',
  },
}];
