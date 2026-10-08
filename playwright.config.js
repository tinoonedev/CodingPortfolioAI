import { defineConfig, devices } from '@playwright/test';

const realWorkspaceIntegration = process.env.WORKSPACE_REAL_INTEGRATION === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: realWorkspaceIntegration ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  preserveOutput: 'never',
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI && !realWorkspaceIntegration,
    timeout: 30_000,
    env: realWorkspaceIntegration
      ? { WORKSPACE_SKIP_ENV_FILE: '1' }
      : {
          WORKSPACE_SKIP_ENV_FILE: '1',
          DATABASE_URL: '',
          STUDIO_WORKSPACE_ID: '',
          STUDIO_WORKSPACE_NAME: '',
        },
  },
});
