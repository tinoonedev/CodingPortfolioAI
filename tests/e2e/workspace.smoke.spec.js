import { test, expect } from '@playwright/test';

test('unconfigured production workspace shows real setup requirements and no local fallback @smoke', async ({ page }) => {
  test.skip(process.env.WORKSPACE_REAL_INTEGRATION === '1', 'Configured PostgreSQL is exercised by the password account smoke scenario.');
  await page.goto('/');

  await expect(page.getByText('WORKSPACE SETUP')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect the real workspace.' })).toBeVisible();
  await expect(page.getByText('No project data is saved in this browser.')).toBeVisible();
  await expect(page.getByRole('list').getByText('DATABASE_URL', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the labeled prototype demo' })).toHaveAttribute('href', '/demo');
});
