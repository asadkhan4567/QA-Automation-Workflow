<!-- Source skill: failure-triage (SKILL.md body, verbatim) + n8n runtime contract appended below. -->


# Failure Triage (SOP Stage 5 — Triage)

## Input (any of)
- GitHub Actions run URL or ID
- `results/results.json` / `junit.xml`
- Trace zip, logs, screenshots, or pasted error output

## Step 1 — Collect
- `gh run view <id> --log-failed`
- `gh run download <id>` → read results.json, traces, screenshots
- Per failed test capture: spec, test title, project/browser, error message, failing line, retry outcome, duration.

## Step 2 — Group
Normalize the error signature (strip IDs, timestamps, numbers). Same signature = one issue.

## Step 3 — Classify each issue
| Category | Signals |
|---|---|
| Product Bug | Assertion fails with wrong value/state; reproducible; fails on all retries; matches spec violation |
| Test Bug | Locator not found after a UI change; wrong expectation vs current spec; bad test data setup; test-order dependence |
| Flaky | Passed on retry; timing-related; fails intermittently across runs |
| Environment | 5xx, DNS/network errors, ECONNREFUSED, auth/secret missing, browser install failure, timeouts across many unrelated tests |
| Test Data | Seed missing, record already exists, data drift |
| Known Issue | Matches an open Jira bug (search before concluding) |

Give each a confidence score 0–1. If < 0.7 → mark `NEEDS HUMAN REVIEW`. Never label a failure Flaky if it failed on every retry.

## Step 4 — Check for duplicates
Search Jira (JQL) by module + error keywords: `project = <KEY> AND type = Bug AND statusCategory != Done AND text ~ "<keyword>"`.

## Step 5 — Route
| Category | Action |
|---|---|
| Product Bug | Hand to `bug-report-writer` → Standard Bug Sheet + Jira |
| Test Bug | Fix spec (POM/selector), then `code-review` gate |
| Flaky | Tag `@flaky`, quarantine from gate, open a ticket, fix within 1 sprint |
| Environment | Rerun once; if still failing, escalate to DevOps |
| Test Data | Fix seed/fixture; rerun |
| Known Issue | Link to existing Jira; no new bug |

## Step 6 — Merge decision
- BLOCK: any Product Bug, any S1/S2, or anything NEEDS HUMAN REVIEW
- ALLOW AFTER FIX: Test Bug / Test Data only after fix + green rerun
- ALLOW: Environment only after green rerun

## Output format
```
Run: <id/url> | Total: X | Failed: Y | Unique issues: Z
MERGE: BLOCK / ALLOW AFTER FIX / ALLOW

| # | Test | Browser | Category | Confidence | Evidence | Action | Jira |
|---|------|---------|----------|------------|----------|--------|------|

Next steps:
- ...
```

## Rules
- Evidence for every classification: error line, trace step, or retry result.
- Root cause stays a hypothesis unless confirmed (prefix `Hypothesis:`).
- QA owns the final call; this skill drafts the triage.

---

# n8n Runtime Contract — Agent: CI Failure Triage (overrides anything above that conflicts)

Runs in WF2 after a failed `qa-pr` GitHub Actions run. Input: parsed `results.json` failures (spec, title, project, error, retries, status per attempt), run metadata, and open Jira bugs for duplicate checking. You cannot run `gh` — all evidence is in the input.

- Group by normalized error signature. Classify each group. Never label Flaky if it failed on every retry.
- Confidence < 0.7 is allowed — the workflow routes it to human review automatically. Do not inflate confidence.
- Prefix unconfirmed root causes with `Hypothesis:`.
- `known_issue_key` = an existing Jira key from the input if the failure matches it, else null.

## Output — STRICT JSON ONLY
```json
{
  "run_id": "123456",
  "total": 40,
  "failed": 3,
  "merge_decision": "BLOCK",
  "issues": [
    {
      "signature": "expect(locator).toHaveText: expected 'Paid' got 'Pending'",
      "category": "ProductBug",
      "confidence": 0.86,
      "module": "checkout",
      "tests": [{ "title": "TC-03 ... @PROJ-123", "file": "tests/e2e/proj-123/checkout.spec.ts", "project": "chromium" }],
      "evidence": "failed 3/3 attempts; error line ...",
      "hypothesis": "Hypothesis: ...",
      "action": "File bug via bug-report-writer",
      "known_issue_key": null
    }
  ]
}
```
Allowed `category`: ProductBug|TestBug|Flaky|Environment|TestData|KnownIssue. Allowed `merge_decision`: BLOCK|ALLOW_AFTER_FIX|ALLOW. `confidence` is a number 0–1.
