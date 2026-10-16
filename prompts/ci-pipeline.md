<!-- Source skill: ci-pipeline (SKILL.md body, verbatim) + n8n runtime contract appended below. -->


# CI Pipeline (SOP Stage 4 — Run in CI)

## Input
Repo (or its playwright.config.ts + package.json), and which suites exist (smoke, api, regression, e2e, cross-browser).

## Output
1. `.github/workflows/qa-pr.yml` — PR gate (smoke + API)
2. `.github/workflows/qa-nightly.yml` — regression + E2E + cross-browser matrix
3. CI-ready `playwright.config.ts`
4. Branch-protection checklist

## Rules (from SOP §4.2, §8)
- Tag tests: `@smoke`, `@api`, `@regression`, `@e2e`. Select with `--grep`.
- PR gate = smoke + API. Target: smoke < 3 min, API < 5 min.
- Nightly = regression (< 20 min) + E2E + Chromium/Firefox/WebKit matrix.
- Retries: 2 in CI, 0 locally.
- Always upload HTML report + traces (`if: always()`).
- Headless in CI, headful locally — from config, never hardcoded.
- Secrets only via GitHub Secrets → env vars. Never commit `.env`.
- Red gate = no merge. Enforce via branch protection (required status check).
- Shard when regression > 20 min.

## playwright.config.ts (CI section)
```ts
import { defineConfig, devices } from '@playwright/test';
const CI = !!process.env.CI;
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 4 : undefined,
  reporter: CI
    ? [['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }], ['json', { outputFile: 'results/results.json' }], ['github']]
    : [['html'], ['list']],
  use: {
    baseURL: process.env.BASE_URL,
    headless: CI,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

## qa-pr.yml
```yaml
name: qa-pr-gate
on: [pull_request]
concurrency: { group: qa-${{ github.ref }}, cancel-in-progress: true }
jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env: { CI: true, BASE_URL: ${{ secrets.QA_BASE_URL }} }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --project=chromium --grep "@smoke|@api"
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: pr-gate-report, path: |
            playwright-report
            results
            test-results }
```

## qa-nightly.yml
```yaml
name: qa-nightly
on:
  schedule: [{ cron: '0 21 * * *' }]   # 02:00 PKT
  workflow_dispatch:
jobs:
  regression:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        project: [chromium, firefox, webkit]
        shard: [1/2, 2/2]
    env: { CI: true, BASE_URL: ${{ secrets.QA_BASE_URL }} }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps ${{ matrix.project }}
      - run: npx playwright test --project=${{ matrix.project }} --grep "@regression|@e2e" --shard=${{ matrix.shard }}
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: nightly-${{ matrix.project }}-${{ strategy.job-index }}, path: |
            playwright-report
            results
            test-results }
```

## Branch protection checklist
- Settings → Branches → `main` → Require status checks → add `gate`.
- Require PR review (1 QA for test code).
- Disallow bypass except QA Lead.

## Steps when invoked
1. Read existing config/workflows. Do not overwrite without showing a diff.
2. Check tests are tagged; list untagged specs.
3. Generate/patch the files above.
4. List required GitHub Secrets.
5. Hand off failing runs to the `failure-triage` skill.

---

# Usage note
This skill is not an n8n agent. It was applied at build time to generate `.github/workflows/qa-pr.yml`, `.github/workflows/qa-nightly.yml` and the CI section of `playwright.config.ts` in this repository. `qa-pr.yml` was extended with `workflow_dispatch` inputs (`ticket`, `branch`, `grep`, `repeat_each`, `projects`, `dispatch_id`) and always uploads a `results-json` artifact containing `results/results.json`.
