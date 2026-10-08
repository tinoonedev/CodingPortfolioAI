import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';

const realWorkspaceIntegration = process.env.WORKSPACE_REAL_INTEGRATION === '1';
const openAiConfigurationIntegration = process.env.WORKSPACE_OPENAI_CONFIG_INTEGRATION === '1';
const openAiIntegrationKeyring = openAiConfigurationIntegration
  ? JSON.stringify({ activeKeyId: 'playwright-no-egress', keys: { 'playwright-no-egress': randomBytes(32).toString('base64') } })
  : undefined;

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
      ? {
          WORKSPACE_SKIP_ENV_FILE: '1',
          ...(openAiConfigurationIntegration ? {
            OPENAI_TOKEN_ENCRYPTION_KEYRING: openAiIntegrationKeyring,
            OPENAI_MODEL_PRICING_USD_PER_MILLION: JSON.stringify({ 'integration-no-egress': { input: 0.01, output: 0.01 } }),
          } : {}),
        }
      : {
          WORKSPACE_SKIP_ENV_FILE: '1',
          DATABASE_URL: '',
          STUDIO_WORKSPACE_ID: '',
          STUDIO_WORKSPACE_NAME: '',
        },
  },
});
