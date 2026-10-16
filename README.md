# Sprint QA Automation (n8n + Playwright + GitHub Actions)

Four n8n workflows that implement the QA SOP end to end:
**Design → Automate → Review → Run in CI → Triage → Report → Verify**.

| # | Workflow (n8n draft) | ID | Trigger | SOP stages |
|---|---|---|---|---|
| WF1 | **QA \| Design & Automate** | `WCF3bpxCFfFPp0RD` | Manual + every 2 h | Design → Automate → Review → Run in CI |
| WF2 | **QA \| CI Result & Triage** | `wJkkoDr16zW22l65` | GitHub `workflow_run` webhook (HMAC verified) | Triage → Report |
| WF3 | **QA \| Fix Verification** | `5d3Tygetxk5udWMP` | Manual + daily 10:00 Asia/Karachi | Verify |
| WF4 | **QA \| Error Handler** | `J5xzUk8hMd46SmLP` | Error Trigger | alerting for WF1–WF3 |

All four are **unpublished drafts** in the personal project of the n8n instance `asad921.app.n8n.cloud`.
Nothing is published or activated; PRs are never auto-merged and tickets are never auto-closed.

```
Jira (Ready for QA) ──WF1──▶ Test Design ▶ Spec Gen ▶ [API] [Data] ▶ Code Review ⟲(≤2)
                              │
                              ▼
                 qa/<KEY> branch + draft PR ─▶ Slack "Approve test PR" ─▶ dispatch qa-pr.yml
                                                                             │
GitHub Actions qa-pr.yml ── workflow_run(completed) webhook ──WF2──▶ success: Jira ✅ / Slack ✅
                                                                    failure: unzip results.json ▶ Triage agent
                                                                       ├ ProductBug ▶ Bug Report agent ▶ Jira Bug + Bug Sheet
                                                                       ├ Flaky/TestBug/TestData ▶ Jira Task (label)
                                                                       ├ Environment ▶ re-run once
                                                                       └ confidence < 0.7 ▶ Slack "Needs human review"
                                                                    Slack summary: MERGE BLOCK / ALLOW_AFTER_FIX / ALLOW
Jira (Fixed) ──WF3──▶ Verification agent ▶ dispatch qa-pr.yml (grep @module, repeat-each 10, 3 engines)
                    ▶ wait for WF2 result in qa_runs ▶ PASS: Verified · FAIL: Reopened ▶ Bug Sheet
Any failure in WF1–WF3 ──WF4──▶ Slack alert (workflow, node, execution ID, error)
```

## Repository layout

| Path | What |
|---|---|
| `n8n/*.json` | Exported workflow JSON (import into any n8n instance) |
| `n8n/src/*.ts`, `n8n/src/code/**` | Source of truth: Workflow-SDK templates + Code-node JavaScript |
| `n8n/build.py` | Renders `n8n/src` → `n8n/build/*.sdk.ts` (injects prompts, code, shared helpers) |
| `prompts/*.md` | Agent system prompts = skill `SKILL.md` body (verbatim) + an n8n runtime contract with the strict JSON schema |
| `.github/workflows/qa-pr.yml` | PR gate + n8n-dispatched runs; inputs `ticket, branch, grep, repeat_each, projects, dispatch_id`; always uploads `results-json` |
| `.github/workflows/qa-nightly.yml` | Nightly regression/E2E, Chromium/Firefox/WebKit × 2 shards |
| `playwright.config.ts` | CI section: retries 2, JSON reporter → `results/results.json`, traces/screens/videos |
| `n8n/test/` | Test pin data, sample generated specs, run summaries, local Code-node harness |

## Agents ↔ skills

| Agent node | Workflow | Skill (`prompts/…`) | Temp | Output contract (validated in a Code node) |
|---|---|---|---|---|
| Test Design Agent | WF1 | asadullahkhan-test-case-writer (`test-design.md`) | 0.2 | ticket, module, has_endpoints, touches_db, gherkin, test_matrix[] |
| Spec Generator Agent | WF1 | asadullahkhan-browser-automation (`spec-generator.md`) | 0.2 | files[] under `tests/e2e/<key>/`, `tests/pages/`, `tests/fixtures/` |
| API Test Generator Agent | WF1 (only if endpoints) | asadullahkhan-api-documentation (`api-test-generator.md`) | 0.2 | files[] under `tests/api/<key>/`, endpoint_coverage[] |
| Data Checks Agent | WF1 (only if DB) | asadullahkhan-data-analyst (`data-checks.md`) | 0.2 | read-only SQL checks + `tests/data/<key>/` spec |
| Code Review Agent | WF1 | asadullahkhan-code-review (`code-review.md`) | 0 | verdict APPROVE \| CHANGES, issues[] |
| CI Failure Triage Agent | WF2 | failure-triage (`failure-triage.md`) | 0 | issues[] {category, confidence, evidence…}, merge_decision |
| Bug Report Agent | WF2 | asadullahkhan-bug-report-writer (`bug-report.md`) | 0 | report + Standard Bug Sheet `sheet_row` |
| Fix Verification Agent | WF3 | fix-verification (`fix-verification.md`) | 0 | ready, module, grep, repeat_each = 10, projects |
| — | repo | ci-pipeline (`ci-pipeline.md`) | — | generated `qa-pr.yml`, `qa-nightly.yml`, `playwright.config.ts` |

Every agent returns strict JSON. The validator Code node strips a code fence if present, `JSON.parse`s, checks the schema (required keys, enums, patterns, min items) and **throws on any mismatch**. That fails the execution, and WF4 raises a Slack alert. Extra guards:
- File paths must sit under the allowed `tests/...` prefixes (no `..`, `.ts` only).
- Generated tests must not contain hard sleeps.
- Data checks must be read-only SQL.
- A Flaky label is auto-corrected if the test failed on every retry.
- Jira transitions to Closed/Done/Resolved are refused.

## Credentials (n8n credentials only — create these, then select them on the nodes)

| Placeholder | n8n credential type | Used by |
|---|---|---|
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | **Jira SW Cloud API** (`jiraSoftwareCloudApi`) — named `Jira (JIRA_EMAIL + JIRA_API_TOKEN)` | Jira nodes + Jira HTTP nodes (predefined credential) |
| `GITHUB_TOKEN` | **GitHub API** (`githubApi`) — fine-grained PAT on `GITHUB_OWNER/GITHUB_REPO` with **Contents RW, Pull requests RW, Actions RW**, Metadata R | GitHub HTTP nodes |
| `ANTHROPIC_API_KEY` | **Anthropic** (`anthropicApi`) | all `Claude · …` model nodes (currently auto-assigned to n8n *Gateway credits* — switch to your key) |
| `SLACK_CHANNEL` | **Slack API** (`slackApi`, bot token with `chat:write`, `channels:read`; approvals need interactivity enabled) | Slack nodes |
| `BUG_SHEET_ID` | **Google Sheets OAuth2** (`googleSheetsOAuth2Api`) | Bug Sheet nodes |

Non-secret IDs live in each workflow's **Config** node (replace every `<SET_ME:…>`):
`JIRA_PROJECT`, `JIRA_BASE_URL`, `GITHUB_OWNER`, `GITHUB_REPO`, `BASE_BRANCH` (default `main`), `SLACK_CHANNEL`, `QA_BASE_URL`, `BUG_SHEET_ID`, `BUG_SHEET_TAB` (default `Bugs`), `PR_DRAFT` (WF1, default `true`), `GITHUB_WEBHOOK_SECRET` (WF2).

GitHub repository **secrets** (Settings → Secrets → Actions): `QA_BASE_URL`, `QA_API_TOKEN`, `QA_DATABASE_URL` (only if data checks are used).

Data Table **`qa_runs`** (id `9mMnRlpTU4S4ezRU`): `ticket, branch, pr_url, run_id, status, kind, dispatch_id, conclusion, merge_decision, review_verdict, module`.
Bug Sheet tab **`Bugs`** header row: `Bug ID | Jira Key | Title | Module | Severity | Priority | Status | Environment | Browser | Build | Steps | Expected | Actual | Evidence | Reported Date | Reported By | Source Ticket | CI Run | Verified Date | Verified By | Regression Test ID`.

## Setup

1. **Repo files.** Copy `.github/workflows/qa-pr.yml`, `qa-nightly.yml`, `playwright.config.ts`, `package.json`, and `tsconfig.json` into the app's test repo (`GITHUB_OWNER/GITHUB_REPO`), then run `npm install` and commit the `package-lock.json`. Add the repo secrets.
2. **Branch protection** (ci-pipeline skill):
   - `main` requires the status check `gate`.
   - Require 1 QA review.
   - No bypass except the QA Lead.
   - WF1 opens PRs as drafts, so the PR gate runs only once a human marks the PR ready. The n8n-dispatched run reports on the same commit.
3. **n8n credentials.** Create the five credentials above and select them on every node with a credential warning. This includes the HTTP Request nodes, which use *Predefined credential type*.
4. **Config nodes.** Fill in the Config node in WF1, WF2, WF3, and WF4.
5. **Jira workflow.** Statuses `Ready for QA`, `Fixed`, `Verified`, `Reopened` must exist, and so must transitions *Fixed → Verified* and *Fixed → Reopened*. WF3 looks transitions up by target status name.
6. **Publish and wire WF4.** Publish WF4, then in WF1, WF2 and WF3 go to *Workflow settings → Error workflow → QA | Error Handler*. n8n accepts only a published workflow as an error workflow.
7. **Webhook (WF2).** Publish WF2 to get its production URL: `https://<your-n8n>/webhook/qa-ci-result`. In GitHub, add a webhook under *Repo → Settings → Webhooks → Add webhook*:
   - Payload URL: the production URL.
   - Content type: `application/json`.
   - Secret: same value as Config `GITHUB_WEBHOOK_SECRET`.
   - Events: *Let me select individual events → **Workflow runs***.

   WF2 checks `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, constant-time compare), rejects anything else, and ignores runs other than `qa-pr.yml`.
8. **Publish WF1 and WF3** when you're ready for the schedules (every 2 h; daily 10:00 PKT) to run.

## How it fits together

- **Correlation.** WF1/WF3 generate a `dispatch_id` and pass it to `qa-pr.yml`, whose `run-name` is `qa-pr <KEY> [<dispatch_id>]`. WF2 parses `display_title` to find the ticket and the `qa_runs` row, so results are matched even if the run id was not known at dispatch time.
- **Idempotency.**
  - WF1 skips any ticket already in `qa_runs`.
  - The JQL also excludes `qa-automated`, written as `labels is EMPTY OR labels != "qa-automated"`, because Jira's `!=` alone drops unlabeled issues.
  - The branch commit reuses `qa/<KEY>` if it already exists, and an existing open PR is picked up instead of opening a duplicate.
  - To re-run a ticket, delete its `qa_runs` row and remove the label.
- **Review loop.** If Code Review returns `CHANGES`, its issues go back to the Spec Generator, at most 2 times. After that the PR is still opened, with a warning banner, so a human decides.
- **Human gate.** The Slack *Approve & run CI / Decline* message waits up to 24 h. Declined or timed-out tickets are recorded as `declined_or_timed_out`.
- **Fix verification.** Bugs are never moved to Closed: PASS → **Verified**, and a human QA closes. FAIL → **Reopened** with run evidence. If no deploy evidence is found, the bug gets a NOT READY comment and stays Fixed.

## How to test

- **Fail-fast check (WF1):** pin `Test Design Agent` with a malformed reply. Execution 617 failed with `[Test Design] schema mismatch (8): …`, as intended.
- **WF1** (execution **616**, success): sample ticket **PROJ-101**, "Apply a coupon code at checkout", with an API endpoint. The agent outputs were written by applying the same skills and pinned (no Anthropic, Jira, GitHub or Slack credentials in the instance yet). Nodes that executed for real:
  - Normalize Tickets
  - Skip Tickets Already in qa_runs (real Data Table read)
  - Loop Tickets
  - every validator
  - Has Endpoints? (true) → API branch, Touches DB? (false)
  - Review gate (APPROVE, 0 revisions)
  - Build PR Payload
  - PR Info, Approved?, Pick Run ID

  Output: branch `qa/PROJ-101`, 4 files, 12 test cases. The PR body is in `n8n/test/runs/wf1-exec-616.pr-body.md` and the summary in `wf1-exec-616.summary.json`.
- **WF2** (execution **621**, success): a failed run with a ProductBug, a Flaky test, an Environment failure, and one low-confidence issue, which exercised all four routes. Details are in `n8n/test/runs/wf2-exec-621.summary.md`.
- **WF3** (executions **622** PASS → `Verify`→Verified, skipping the listed `Close` transition; **623** FAIL → Reopened).
- **Local Code-node tests**: `node n8n/test/local/test-wf2.js n8n/src/code/wf2` (HMAC accept/reject + unzip/parse) and `node n8n/test/local/test-triage.js n8n/src/code` (triage routing + merge decision).
- **Live end-to-end** after setup: move a story to *Ready for QA* in an open sprint → run WF1 manually → approve in Slack → watch the `qa-pr` run → WF2 posts the triage summary.

## Known limits / deviations

- **Retry backoff.** HTTP and API nodes use n8n's built-in retry: 3 tries, 5 s apart, with a 60 s timeout. n8n retries at a fixed interval and caps the wait at 5 s, so this is not true exponential backoff. If you need exponential backoff, add an error-output → Wait (2ⁿ s) → retry loop on the critical nodes.
- **Temperature.** Model nodes use `claude-sonnet-5-5` with temperature 0.2 (design) and 0 (review, triage, bug, verification). The n8n node documents that temperature is ignored on Sonnet 5+ models. To have it honoured, switch the model ID to an older model that supports it. Output determinism comes mainly from the strict JSON contracts and validators.
- **Webhook secret.** n8n Code nodes cannot read credentials, so the secret sits in WF2's Config node. Restrict who can edit WF2.
- **Unzip.** n8n Cloud blocks the `zlib` module in Code nodes, so the artifact is unzipped by a small pure-JS ZIP/DEFLATE reader inside the Code node, tested against real zips.
- **Teams.** Approvals are Slack only. For Teams, replace the Slack send-and-wait node with *Microsoft Teams → Send and Wait for Response*.

## Rebuilding the SDK sources

```bash
python3 n8n/build.py            # → n8n/build/*.sdk.ts (full prompts + code)
python3 n8n/build.py --stub     # small structural build for validate_workflow
```
