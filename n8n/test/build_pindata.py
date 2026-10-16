#!/usr/bin/env python3
"""Build pin data for the WF1 test run against sample ticket PROJ-101.

Agent outputs below are what the agents are contracted to return (strict JSON strings);
they are pinned because the test environment has no Jira/GitHub/Slack credentials.
"""
import json, pathlib
HERE = pathlib.Path(__file__).parent
S = HERE / "sample-ticket"
f = lambda n: (S / n).read_text()

ticket = {
    "key": "PROJ-101",
    "fields": {
        "summary": "Apply a coupon code at checkout",
        "description": "As a shopper I want to apply a coupon code at checkout so that I get a discount.\n"
        "AC1: Active code SAVE10 reduces the subtotal by 10% and shows 'Coupon applied'.\n"
        "AC2: Expired code shows 'This coupon has expired'; total unchanged.\n"
        "AC3: Unknown code shows 'Invalid coupon code'.\n"
        "AC4: Only one coupon per order -> 'Only one coupon can be applied'.\n"
        "API: POST /api/cart/{cartId}/coupon {code} -> 200 {code, discount, total}; 400 missing code; 410 expired; 401 unauthenticated; 404 cart not owned.",
        "labels": ["checkout"], "components": [{"name": "Checkout"}],
        "priority": {"name": "High"}, "status": {"name": "Ready for QA"}, "issuetype": {"name": "Story"},
    },
}
T = ["@PROJ-101", "@checkout-coupon"]
design = {
    "ticket": "PROJ-101", "module": "checkout-coupon", "has_endpoints": True,
    "endpoints": [{"method": "POST", "path": "/api/cart/{cartId}/coupon", "description": "Apply a coupon to a cart"}],
    "touches_db": False, "db_entities": [],
    "assumptions": ["Cart with 2 x $25 items (subtotal $50) can be seeded via /api/test-support/carts", "SUMMER2025 is a seeded expired coupon; WELCOME5 a second valid coupon"],
    "gherkin": "Feature: Coupon at checkout\n  Background:\n    Given a cart with subtotal $50.00\n  Scenario: Valid coupon\n    When I apply \"SAVE10\"\n    Then I see \"Coupon applied\" and total \"$45.00\"\n  Scenario: Expired coupon\n    When I apply \"SUMMER2025\"\n    Then I see \"This coupon has expired\" and total \"$50.00\"\n  Scenario: Unknown coupon\n    When I apply \"NOPE-123\"\n    Then I see \"Invalid coupon code\"\n  Scenario: Second coupon\n    Given \"SAVE10\" is applied\n    When I apply \"WELCOME5\"\n    Then I see \"Only one coupon can be applied\"",
    "test_matrix": [
        {"id": "TC-01", "title": "valid coupon SAVE10 reduces subtotal by 10%", "priority": "P0", "type": "Positive", "preconditions": "cart $50", "steps": ["open checkout", "apply SAVE10"], "expected": "'Coupon applied', discount -$5.00, total $45.00", "test_data": "SAVE10", "tags": T + ["@smoke"]},
        {"id": "TC-02", "title": "expired coupon shows error and keeps total", "priority": "P1", "type": "Negative", "preconditions": "cart $50", "steps": ["apply SUMMER2025"], "expected": "'This coupon has expired', total $50.00", "test_data": "SUMMER2025", "tags": T + ["@regression"]},
        {"id": "TC-03", "title": "unknown coupon is rejected", "priority": "P1", "type": "Negative", "preconditions": "cart $50", "steps": ["apply NOPE-123"], "expected": "'Invalid coupon code', no discount row", "test_data": "NOPE-123", "tags": T + ["@regression"]},
        {"id": "TC-04", "title": "second coupon is refused", "priority": "P1", "type": "Negative", "preconditions": "SAVE10 applied", "steps": ["apply WELCOME5"], "expected": "'Only one coupon can be applied', total stays $45.00", "test_data": "WELCOME5", "tags": T + ["@regression"]},
        {"id": "TC-05", "title": "empty and whitespace codes are not submitted", "priority": "P2", "type": "Boundary", "preconditions": "cart $50", "steps": ["apply ''", "apply '   '"], "expected": "'Enter a coupon code'", "test_data": "'', '   '", "tags": T + ["@regression"]},
        {"id": "TC-06", "title": "script payload in code is rendered as text", "priority": "P1", "type": "Security", "preconditions": "cart $50", "steps": ["apply <img src=x onerror=alert(1)>"], "expected": "'Invalid coupon code', no dialog", "test_data": "XSS payload", "tags": T + ["@regression"]},
        {"id": "TC-07", "title": "API 200 valid code", "priority": "P0", "type": "Positive", "preconditions": "token", "steps": ["POST code SAVE10"], "expected": "200 {discount:5,total:45}", "test_data": "SAVE10", "tags": T + ["@api", "@smoke"]},
        {"id": "TC-08", "title": "API 410 expired code", "priority": "P1", "type": "Negative", "preconditions": "token", "steps": ["POST SUMMER2025"], "expected": "410 'This coupon has expired'", "test_data": "SUMMER2025", "tags": T + ["@api", "@regression"]},
        {"id": "TC-09", "title": "API 400 missing code", "priority": "P1", "type": "Negative", "preconditions": "token", "steps": ["POST {}"], "expected": "400 'code is required'", "test_data": "{}", "tags": T + ["@api", "@regression"]},
        {"id": "TC-10", "title": "API 401 without token", "priority": "P1", "type": "Security", "preconditions": "no token", "steps": ["POST without Authorization"], "expected": "401", "test_data": "-", "tags": T + ["@api", "@regression"]},
        {"id": "TC-11", "title": "API 404 for another user's cart", "priority": "P1", "type": "Security", "preconditions": "token for user A", "steps": ["POST to user B cart"], "expected": "404", "test_data": "foreign cart", "tags": T + ["@api", "@regression"]},
        {"id": "TC-12", "title": "API SQL injection in code is rejected", "priority": "P2", "type": "Security", "preconditions": "token", "steps": ["POST ' OR 1=1 --"], "expected": "400, no SQL error leaked", "test_data": "' OR 1=1 --", "tags": T + ["@api", "@regression"]},
    ],
}
spec = {"ticket": "PROJ-101", "grep": "@PROJ-101", "files": [
    {"path": "tests/pages/checkout.page.ts", "content": f("checkout.page.ts")},
    {"path": "tests/fixtures/checkout.fixture.ts", "content": f("checkout.fixture.ts")},
    {"path": "tests/e2e/proj-101/coupon.spec.ts", "content": f("coupon.spec.ts")},
], "notes": ["Assumes data-testid on coupon-input, coupon-message, order-subtotal, order-discount, order-total"]}
api = {"files": [{"path": "tests/api/proj-101/coupon.api.spec.ts", "content": f("coupon.api.spec.ts")}],
       "endpoint_coverage": [{"method": "POST", "path": "/api/cart/{cartId}/coupon", "scenarios": ["200 valid", "410 expired", "400 missing code", "401 no token", "404 foreign cart", "400 SQL injection"]}]}
review = {"verdict": "APPROVE", "summary": "POM + fixture-based cart seeding with teardown, web-first assertions, every matrix row covered and tagged. One minor and one nit.",
          "issues": [{"severity": "minor", "file": "tests/e2e/proj-101/coupon.spec.ts", "line": 31, "problem": "TC-05 loops two inputs in one test; a failure on '' hides the whitespace case.", "fix": "Split into two tests or use test.describe.each."},
                     {"severity": "nit", "file": "tests/api/proj-101/coupon.api.spec.ts", "line": 5, "problem": "newCart helper duplicates the fixture seed logic.", "fix": "Export seedCart from tests/fixtures/checkout.fixture.ts."}],
          "good": ["No sleeps", "getByTestId/getByRole only", "Cart cleanup in fixture teardown", "Security cases for XSS, authz and SQLi"]}

j = lambda o: [{"json": o}]
pin = {
    "Run Manually": j({}),
    "Search Ready-for-QA Tickets": j(ticket),
    "Test Design Agent": j({"output": json.dumps(design)}),
    "Spec Generator Agent": j({"output": json.dumps(spec)}),
    "API Test Generator Agent": j({"output": json.dumps(api)}),
    "Code Review Agent": j({"output": json.dumps(review)}),
    "GitHub · Get Base Branch": j({"name": "main", "commit": {"sha": "9f2c1e7a4b", "commit": {"tree": {"sha": "4d1b0c99aa"}}}}),
    "GitHub · Create Tree": j({"sha": "7e3a5512cd"}),
    "GitHub · Create Commit": j({"sha": "c0ffee1234"}),
    "GitHub · Create Branch qa/KEY": j({"ref": "refs/heads/qa/PROJ-101", "object": {"sha": "c0ffee1234"}}),
    "GitHub · Open Pull Request": j({"number": 87, "html_url": "https://github.com/acme/webapp/pull/87", "draft": True}),
    "Slack · Approve Test PR": j({"data": {"approved": True, "respondedAt": "2026-10-16T09:12:00Z"}}),
    "GitHub · Dispatch qa-pr.yml": j({}),
    "Jira · Add Label qa-automated": j({}),
    "Jira · Comment PR Link": j({"id": "10442"}),
    "qa_runs · Record Dispatched Run": j({"id": 1, "note": "pinned in test so qa_runs is not polluted"}),
}
(HERE / "wf1-pindata.json").write_text(json.dumps(pin, indent=1))
print(len(json.dumps(pin)))
