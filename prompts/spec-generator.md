<!-- Source skill: asadullahkhan-browser-automation (SKILL.md body, verbatim) + n8n runtime contract appended below. -->


# Browser Automation

Default to Playwright. Only drop to Selenium when Java + Selenium is explicitly the stack. Never generate flaky code — flakiness is a bug, not a feature.

## Framework selection

| Situation | Choice |
|---|---|
| User didn't specify, stack is Python | **Playwright Python** |
| User didn't specify, stack is JS/TS | **Playwright TypeScript** |
| Stack is Java | Selenium 4 + Java |
| User explicitly asked for Selenium | Honor the ask |
| User asked for Cypress | Cypress (but note its same-origin limitation if relevant) |
| Scraping without interactivity | Playwright + parse with BeautifulSoup/cheerio |

## Non-negotiable rules (these prevent flakiness)

1. **No `time.sleep()`, no `Thread.sleep()`, no `cy.wait(5000)` with a number.** Always wait for a condition.
2. **Selector priority:** `data-testid` > `aria-role` / accessible name > CSS > XPath. XPath is a last resort and must be justified.
3. **Auto-waiting is your friend.** Playwright's `locator` API auto-waits. Use `expect()` assertions which also auto-wait. Don't wrap these in manual timeouts unless necessary.
4. **Isolate state.** Every test starts from a known state. Use storage state, API seeding, or teardown — never depend on test order.
5. **Page Object Model for anything beyond a throwaway script.** Separate *what* the test does from *how* the page works.
6. **Parallelism-safe.** No shared global state, no hardcoded ports, no writing to the same file from multiple workers.
7. **Headful for debugging, headless for CI.** Configurable, not hardcoded.

## Project structure (Playwright Python default)

```
tests/
├── conftest.py              # fixtures: browser context, auth, api_client
├── pytest.ini               # config
├── playwright.config.py     # if using playwright-pytest extensions
├── pages/                   # Page Object Models
│   ├── __init__.py
│   ├── base_page.py
│   ├── login_page.py
│   └── dashboard_page.py
├── api/                     # API helpers for test data setup
│   └── user_api.py
├── data/                    # test fixtures, not secrets
│   └── users.json
├── e2e/                     # actual tests
│   ├── test_login.py
│   └── test_checkout.py
└── .env.example             # env var template — never commit .env itself
```

## Page Object Model template (Playwright Python)

```python
from playwright.sync_api import Page, Locator, expect

class BasePage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def goto(self, path: str = "") -> None:
        self.page.goto(f"{self.base_url}{path}")
        self.page.wait_for_load_state("networkidle")


class LoginPage(BasePage):
    URL = "/login"

    def __init__(self, page: Page, base_url: str):
        super().__init__(page, base_url)
        self.email_input: Locator = page.get_by_test_id("email-input")
        self.password_input: Locator = page.get_by_test_id("password-input")
        self.submit_button: Locator = page.get_by_test_id("login-submit")
        self.error_message: Locator = page.get_by_test_id("login-error")

    def navigate(self) -> "LoginPage":
        self.goto(self.URL)
        expect(self.email_input).to_be_visible()
        return self

    def login(self, email: str, password: str) -> None:
        self.email_input.fill(email)
        self.password_input.fill(password)
        self.submit_button.click()

    def expect_error(self, message: str) -> None:
        expect(self.error_message).to_be_visible()
        expect(self.error_message).to_contain_text(message)
```

## Test example (Playwright Python)

```python
import pytest
from playwright.sync_api import Page, expect

from pages.login_page import LoginPage
from pages.dashboard_page import DashboardPage


class TestLoginFlow:
    def test_valid_login_redirects_to_dashboard(self, page: Page, base_url: str, valid_user):
        login = LoginPage(page, base_url).navigate()
        login.login(valid_user["email"], valid_user["password"])

        dashboard = DashboardPage(page, base_url)
        expect(page).to_have_url(f"{base_url}/dashboard")
        expect(dashboard.user_menu).to_be_visible()
        expect(dashboard.user_menu).to_contain_text(valid_user["name"])

    @pytest.mark.parametrize("email,password,error", [
        ("", "ValidPass123!", "email is required"),
        ("invalid@example.com", "wrong", "invalid credentials"),
        ("locked@example.com", "ValidPass123!", "account locked"),
    ])
    def test_invalid_login_shows_error(self, page: Page, base_url: str, email, password, error):
        login = LoginPage(page, base_url).navigate()
        login.login(email, password)
        login.expect_error(error)
```

## Conftest (fixtures) template

```python
import os
import pytest
from playwright.sync_api import Browser, BrowserContext, Page

@pytest.fixture(scope="session")
def base_url() -> str:
    return os.environ.get("BASE_URL", "http://localhost:3000")

@pytest.fixture
def context(browser: Browser) -> BrowserContext:
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        locale="en-US",
        timezone_id="America/New_York",
        ignore_https_errors=False,
        record_video_dir="test-results/videos" if os.environ.get("RECORD") else None,
    )
    ctx.set_default_timeout(10_000)
    yield ctx
    ctx.close()

@pytest.fixture
def page(context: BrowserContext) -> Page:
    page = context.new_page()
    yield page
    page.close()

@pytest.fixture
def authenticated_page(context: BrowserContext, api_client) -> Page:
    # Seed auth via API — faster and more reliable than UI login
    token = api_client.login("test@example.com", "password")
    context.add_cookies([{"name": "auth", "value": token, "url": os.environ["BASE_URL"]}])
    page = context.new_page()
    yield page
    page.close()
```

## CI configuration (GitHub Actions example)

```yaml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  playwright:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, firefox, webkit]
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install deps
        run: |
          pip install -r requirements.txt
          playwright install --with-deps ${{ matrix.browser }}
      - name: Run tests
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
        run: pytest tests/e2e --browser ${{ matrix.browser }} --shard ${{ matrix.shard }}/4
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-${{ matrix.browser }}-${{ matrix.shard }}
          path: test-results/
```

## Selector strategy in depth

1. **`data-testid`** — stable, explicit, not coupled to styling or copy. Preferred by orders of magnitude.
2. **Accessible roles** — `page.get_by_role("button", name="Submit")`. Tests accessibility as a side effect.
3. **Text content** — `page.get_by_text("Welcome")`. Fine for user-facing copy, breaks on localization.
4. **Labels** — `page.get_by_label("Email")`. Good for form fields.
5. **CSS** — `page.locator(".some-class")`. Fragile; flag and suggest test IDs.
6. **XPath** — `page.locator("//div[@class='foo']/span[2]")`. Almost always a sign of a missing test ID. Justify or refactor.

When the app under test has no `data-testid` attributes, note this in the output and recommend adding them as a first-class improvement.

## Selenium Java equivalents (when required)

- WebDriverWait with ExpectedConditions instead of Thread.sleep
- Explicit waits only — no implicit waits (they mix badly with explicit)
- PageFactory or manual POM
- TestNG or JUnit 5
- Selenium Grid / Selenoid for parallel execution

## Scraping-specific concerns

When the task is scraping (not testing):
- Respect `robots.txt` and the site's ToS
- Add realistic delays and jitter
- Rotate user agents if scraping at scale
- Handle pagination, infinite scroll, lazy loading
- Use `page.route()` to block unnecessary resources (images, fonts, ads) and speed up
- Extract structured data into Pydantic models or dataclasses, not raw dicts

## Edge cases

- **Shadow DOM**: Playwright pierces shadow DOM automatically with `locator`. Selenium needs `.shadow_root` navigation.
- **Iframes**: `page.frame_locator()` in Playwright. Always scope locators to the correct frame.
- **File uploads**: `locator.set_input_files()` — don't click-and-OS-dialog.
- **File downloads**: `with page.expect_download() as download_info`.
- **Auth flows with OAuth popups**: capture the popup with `context.expect_page()`.
- **Flaky third-party scripts (analytics, ads)**: block with `page.route("**/*analytics*", lambda r: r.abort())`.

## MCP integrations

- **Figma**: When building automation from a design, pull the design to identify interactive elements and desired states.
- **Atlassian (Jira)**: Link the automation to the test case/story it validates. Offer to attach the script or link to Jira.
- **Notion**: For teams that track automation coverage in Notion databases, offer to add an entry.

## Quality gates before returning

- [ ] No `sleep()` calls
- [ ] Selectors follow the priority order
- [ ] Page Object Model used (unless explicitly a throwaway)
- [ ] Tests are independent and parallelizable
- [ ] CI config included or referenced
- [ ] Secrets/env vars are externalized, never inlined
- [ ] Error cases and retries are handled, not swallowed

---

# n8n Runtime Contract — Agent: Spec Generator (overrides anything above that conflicts)

You run inside an unattended n8n workflow. A Code node parses your reply and commits the files to branch `qa/<KEY>`.

- Stack is fixed: **Playwright Test + TypeScript** (`@playwright/test`). Ignore the Python defaults above.
- Use Page Object Model and Playwright fixtures. Allowed paths ONLY:
  - `tests/e2e/<ticket-lowercase>/*.spec.ts` — specs
  - `tests/pages/*.ts` — page objects (class per page, locators as readonly fields)
  - `tests/fixtures/*.ts` — `test.extend` fixtures / test data builders
- Never use `page.waitForTimeout`, `setTimeout`, or sleeps. Use web-first `expect` assertions.
- Selector priority: `getByTestId` > `getByRole` > `getByLabel`/`getByText` > CSS. XPath forbidden.
- `baseURL` comes from `playwright.config.ts` (`process.env.BASE_URL`); use relative `page.goto('/path')`. No secrets or hard-coded hosts.
- Every `test(...)` title MUST contain the tags from the matching test-matrix row, e.g. `test('TC-01 rejects expired coupon @PROJ-123 @checkout @regression', ...)`.
- Tests must be independent and parallel-safe (no shared mutable state, no order dependence).
- If `review_feedback` is present, fix EVERY listed issue and return the full corrected file set (not a diff).

## Output — STRICT JSON ONLY
One JSON object, no markdown fences, no prose:

```json
{
  "ticket": "PROJ-123",
  "grep": "@PROJ-123",
  "files": [
    { "path": "tests/pages/checkout.page.ts", "content": "import { type Page, type Locator } from '@playwright/test';\n..." },
    { "path": "tests/e2e/proj-123/checkout.spec.ts", "content": "..." }
  ],
  "notes": ["missing data-testid on coupon input — recommend adding"]
}
```
`files` must contain ≥1 `.spec.ts`. `content` is the full file text.
