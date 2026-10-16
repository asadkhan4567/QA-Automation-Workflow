#!/usr/bin/env python3
"""Pin data for the WF2 test: failed qa-pr run for PROJ-101 (1 product bug, 1 flaky, 1 env, 1 low-confidence)."""
import json, pathlib
HERE = pathlib.Path(__file__).parent
run = {"run_id": "11873402211", "run_attempt": 1, "conclusion": "failure", "run_url": "https://github.com/acme/webapp/actions/runs/11873402211",
       "artifacts_url": "https://api.github.com/repos/acme/webapp/actions/runs/11873402211/artifacts", "head_branch": "qa/PROJ-101", "head_sha": "c0ffee1234abcd",
       "trigger_event": "workflow_dispatch", "display_title": "qa-pr PROJ-101 [PROJ-101-616-1792180312375]", "repo": "acme/webapp", "ticket": "PROJ-101",
       "dispatch_id": "PROJ-101-616-1792180312375", "row_key": "PROJ-101-616-1792180312375", "delivery": "test-delivery"}
failures = [
 {"title": "TC-02 expired coupon shows error and keeps total @PROJ-101 @checkout-coupon @regression", "file": "e2e/proj-101/coupon.spec.ts:11", "project": "chromium", "outcome": "unexpected", "attempts": ["failed","failed","failed"], "passed_on_retry": False, "failed_all_retries": True, "error": "Error: expect(locator).toHaveText(expected)\nLocator: getByTestId('coupon-message')\nExpected: \"This coupon has expired\"\nReceived: \"Coupon applied\"", "location": "tests/e2e/proj-101/coupon.spec.ts:13", "duration_ms": 15150, "attachments": ["trace","screenshot"]},
 {"title": "TC-04 second coupon is refused @PROJ-101 @checkout-coupon @regression", "file": "e2e/proj-101/coupon.spec.ts:23", "project": "chromium", "outcome": "flaky", "attempts": ["timedOut","passed"], "passed_on_retry": True, "failed_all_retries": False, "error": "Test timeout of 30000ms exceeded.", "location": "", "duration_ms": 31200, "attachments": ["trace"]},
 {"title": "TC-09 API 400 missing code @api @PROJ-101 @checkout-coupon", "file": "api/proj-101/coupon.api.spec.ts:28", "project": "chromium", "outcome": "unexpected", "attempts": ["failed","failed","failed"], "passed_on_retry": False, "failed_all_retries": True, "error": "apiRequestContext.post: connect ECONNREFUSED 10.0.4.12:443", "location": "tests/api/proj-101/coupon.api.spec.ts:5", "duration_ms": 900, "attachments": []},
 {"title": "TC-06 script payload in code is rendered as text @PROJ-101 @checkout-coupon @regression", "file": "e2e/proj-101/coupon.spec.ts:41", "project": "chromium", "outcome": "unexpected", "attempts": ["failed","failed","failed"], "passed_on_retry": False, "failed_all_retries": True, "error": "Expected: \"Invalid coupon code\"\nReceived: \"Enter a coupon code\"", "location": "tests/e2e/proj-101/coupon.spec.ts:44", "duration_ms": 4100, "attachments": ["screenshot"]},
]
parsed = {**run, "kind": "design", "module": "checkout-coupon", "pr_url": "https://github.com/acme/webapp/pull/87", "branch": "qa/PROJ-101", "qa_row_found": True,
          "has_results": True, "artifact_url": "https://api.github.com/repos/acme/webapp/actions/artifacts/2271/zip", "artifact_size": 5120,
          "total": 18, "failed": 4, "stats": {"expected": 14, "unexpected": 3, "flaky": 1}, "failures": failures, "truncated": False}
triage = {"run_id": "11873402211", "total": 18, "failed": 4, "merge_decision": "BLOCK", "issues": [
 {"signature": "toHaveText coupon-message expected 'This coupon has expired' received 'Coupon applied'", "category": "ProductBug", "confidence": 0.88, "module": "checkout-coupon", "tests": [{"title": failures[0]["title"], "file": failures[0]["file"], "project": "chromium"}], "evidence": "Failed 3/3 attempts; coupon.spec.ts:13 received 'Coupon applied' for expired code SUMMER2025", "hypothesis": "Hypothesis: coupon validation does not check expires_at", "action": "File bug via bug-report-writer", "known_issue_key": None},
 {"signature": "Test timeout of Nms exceeded", "category": "Flaky", "confidence": 0.81, "module": "checkout-coupon", "tests": [{"title": failures[1]["title"], "file": failures[1]["file"], "project": "chromium"}], "evidence": "timedOut on attempt 1, passed on retry 1", "hypothesis": "Hypothesis: second-coupon request races cart recalculation", "action": "Tag @flaky, quarantine, open task", "known_issue_key": None},
 {"signature": "ECONNREFUSED <ip>:443", "category": "Environment", "confidence": 0.9, "module": "checkout-coupon", "tests": [{"title": failures[2]["title"], "file": failures[2]["file"], "project": "chromium"}], "evidence": "connect ECONNREFUSED on all 3 attempts before any assertion", "hypothesis": "Hypothesis: QA API pod restarting", "action": "Re-run once; escalate to DevOps if it persists", "known_issue_key": None},
 {"signature": "coupon-message 'Enter a coupon code' for XSS payload", "category": "TestBug", "confidence": 0.55, "module": "checkout-coupon", "tests": [{"title": failures[3]["title"], "file": failures[3]["file"], "project": "chromium"}], "evidence": "Received 'Enter a coupon code' — input may be sanitised to empty, or expectation is wrong", "hypothesis": "Hypothesis: UI strips markup client-side", "action": "Human review", "known_issue_key": None}]}
bug = {"title": "[BUG] Expired coupon SUMMER2025 is accepted at checkout", "summary": "Applying the expired coupon SUMMER2025 at checkout shows 'Coupon applied' and discounts the order instead of rejecting it. Any expired coupon can be redeemed, causing unintended discounts.", "severity": "S2", "priority": "P1", "rationale": "Core checkout pricing rule broken with revenue impact; no customer workaround needed but business loses money.",
       "module": "checkout-coupon", "environment": {"application": "webapp @ c0ffee1", "environment": "QA", "browser": "chromium (Playwright Desktop Chrome)", "url": "/checkout", "build": "c0ffee1234abcd"},
       "steps": ["1. Seed a cart with 2 x TSHIRT-RED-M at $25 (subtotal $50.00)", "2. Open /checkout?cart=<cartId>", "3. Enter 'SUMMER2025' in the coupon field (data-testid=coupon-input)", "4. Click the 'Apply' button", "5. Read the coupon message (data-testid=coupon-message)"],
       "reproduction_rate": "100% (3/3 CI attempts)", "preconditions": "SUMMER2025 exists and expires_at is in the past", "expected": "Message 'This coupon has expired'; total stays $50.00 (PROJ-101 AC2)", "actual": "Message 'Coupon applied'; discount applied",
       "evidence": ["https://github.com/acme/webapp/actions/runs/11873402211", "results-json: trace + screenshot for TC-02"], "hypothesis": "Hypothesis: coupon validation does not compare expires_at with the current time.",
       "regression_tests": ["TC-02 expired coupon shows error and keeps total (tests/e2e/proj-101/coupon.spec.ts)", "TC-08 API 410 expired code (tests/api/proj-101/coupon.api.spec.ts)"],
       "markdown": "# [BUG] Expired coupon SUMMER2025 is accepted at checkout\n\n## Summary\nApplying the expired coupon SUMMER2025 shows 'Coupon applied' and discounts the order.\n\n## Severity & Priority\n**Severity:** S2 Major\n**Priority:** P1 Next sprint\n**Rationale:** Core pricing rule broken, revenue impact.\n\n## Reproduction steps\n1. Seed cart subtotal $50.00\n2. Open /checkout\n3. Enter SUMMER2025\n4. Click Apply\n\n**Reproduction rate:** 100% (3/3)\n\n## Expected result\n'This coupon has expired', total $50.00\n\n## Actual result\n'Coupon applied'\n\n## Evidence\n- https://github.com/acme/webapp/actions/runs/11873402211\n\n## Root cause hypothesis\nHypothesis: expires_at not checked.",
       "sheet_row": {"Bug ID": "", "Jira Key": "", "Title": "[BUG] Expired coupon SUMMER2025 is accepted at checkout", "Module": "checkout-coupon", "Severity": "S2", "Priority": "P1", "Status": "Open", "Environment": "QA", "Browser": "chromium", "Build": "", "Steps": "Seed $50 cart; open /checkout; apply SUMMER2025; click Apply", "Expected": "'This coupon has expired'", "Actual": "'Coupon applied'", "Evidence": "https://github.com/acme/webapp/actions/runs/11873402211", "Reported Date": "2026-10-16", "Reported By": "QA Automation (n8n)", "Source Ticket": "", "CI Run": "", "Verified Date": "", "Verified By": "", "Regression Test ID": "TC-02"}}
j = lambda o: [{"json": o}]
pin = {
  "GitHub workflow_run Webhook": j({"headers": {"x-github-event": "workflow_run"}, "body": {}}),
  "Verify Signature & Filter": j(run),
  "qa_runs · Find Run Row": j({"id": 1, "ticket": "PROJ-101", "kind": "design", "module": "checkout-coupon", "pr_url": "https://github.com/acme/webapp/pull/87", "branch": "qa/PROJ-101", "dispatch_id": run["dispatch_id"]}),
  "GitHub · List Run Artifacts": j({"total_count": 2, "artifacts": [{"name": "results-json", "archive_download_url": parsed["artifact_url"], "expired": False, "size_in_bytes": 5120}, {"name": "pr-gate-report", "archive_download_url": "x", "expired": False}]}),
  "GitHub · Download results-json.zip": j({}),
  "Unzip & Parse results.json": j(parsed),
  "Jira · Open Bugs (dedupe)": j({"key": "PROJ-77", "fields": {"summary": "Checkout total not refreshed after coupon removal", "labels": ["qa-automation", "checkout-coupon"]}}),
  "CI Failure Triage Agent": j({"output": json.dumps(triage)}),
  "Bug Report Agent": j({"output": json.dumps(bug)}),
  "Jira · Create Bug": j({"id": "10601", "key": "PROJ-131", "self": "https://example.atlassian.net/rest/api/2/issue/10601"}),
  "Bug Sheet · Append Row": j({"updated": True}),
  "Jira · Create Task (flaky / test-bug)": j({"id": "10602", "key": "PROJ-132"}),
  "GitHub · Re-run Failed Jobs": j({}),
  "Slack · Needs Human Review": j({"ok": True}),
  "Slack · Triage Summary": j({"ok": True}),
  "Jira · Comment Triage on Ticket": j({"id": "10604"}),
  "qa_runs · Record Failed + Decision": j({"id": 1, "note": "pinned so qa_runs is not polluted"}),
}
(HERE / "wf2-pindata.json").write_text(json.dumps(pin))
print(json.dumps(pin))
