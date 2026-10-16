# WF2 test — execution 621 (status: success)

Input: failed `qa-pr` run 11873402211 for PROJ-101 (attempt 1), 18 tests, 4 failures.
Pinned: webhook + verified payload, GitHub/Jira/Slack/Sheets calls, agent outputs. Executed for real: Config, Run Context,
routing (IF/Switch), Validate Triage JSON (schema + Flaky guard + deterministic merge decision), One Item per Issue,
Route Issue, Validate Bug JSON, Build Bug Sheet Row, Build Triage Summary.

| # | Category | Conf | Route taken | Downstream |
|---|---|---|---|---|
| 1 | ProductBug | 0.88 | product_bug | Bug Report Agent → Validate Bug JSON → Jira · Create Bug (PROJ-131) → Bug Sheet row |
| 2 | Flaky | 0.81 | task | Jira · Create Task (label `flaky`) |
| 3 | Environment | 0.90 | environment | First Attempt? = true → GitHub · Re-run Failed Jobs |
| 4 | TestBug | 0.55 | review (conf < 0.7) | Slack · Needs Human Review |

MERGE: **BLOCK** (agent agreed).

Bug Sheet row produced:
```json
{"Bug ID":"PROJ-131","Jira Key":"PROJ-131","Title":"[BUG] Expired coupon SUMMER2025 is accepted at checkout","Module":"checkout-coupon","Severity":"S2","Priority":"P1","Status":"Open","Environment":"QA","Browser":"chromium","Build":"c0ffee1234abcd","Reported Date":"2026-10-16","Reported By":"QA Automation (n8n)","Source Ticket":"PROJ-101","CI Run":"https://github.com/acme/webapp/actions/runs/11873402211","Regression Test ID":"TC-02"}
```

Slack summary produced:
```
:no_entry: *qa-pr triage* — PROJ-101 · <run 11873402211> (attempt 1)
Total 18 · Failed 4 · Unique issues 4
# Category    Conf Route        Test
1  ProductBug  0.88 product_bug  TC-02 expired coupon shows error and keeps tot
2  Flaky       0.81 task         TC-04 second coupon is refused @PROJ-101 @chec
3  Environment 0.90 environment  TC-09 API 400 missing code @api @PROJ-101 @che
4  TestBug     0.55 review       TC-06 script payload in code is rendered as te
*MERGE: BLOCK*
```

Signature verification and the pure-JS unzip were tested locally against real HMAC/zip data
(`n8n/test/local/`): valid signature accepted, tampered/missing rejected; deflate/stored/fixed zips match byte-for-byte.
