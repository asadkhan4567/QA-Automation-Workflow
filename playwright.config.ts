import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  // ---- CI section (SOP §4.2): retries 2 in CI / 0 locally, headless from env, artifacts always ----
  retries: CI ? 2 : 0,
  workers: CI ? 4 : undefined,
  reporter: CI
    ? [
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'results/junit.xml' }],
        ['json', { outputFile: 'results/results.json' }], // consumed by n8n WF2 triage
        ['github'],
      ]
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
