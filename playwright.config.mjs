import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const e2eRoot = resolve('.builder', 'e2e');
const baseURL = process.env.BUILDER_E2E_URL || 'http://127.0.0.1:3117';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  outputDir: 'output/playwright/results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.BUILDER_E2E_URL ? undefined : {
    command: 'npm run dev -- -H 127.0.0.1 -p 3117',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BUILDER_STATE_DB: resolve(e2eRoot, 'state.db'),
      BUILDER_PROJECTS_ROOT: resolve(e2eRoot, 'projects'),
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
