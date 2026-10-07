import { test, expect } from '@playwright/test';

test('creates a clearly labeled local intake and restores it after reload @sanity', async ({ page }) => {
  const projectName = `Northstar ${Date.now()}`;

  await page.goto('/demo');
  await page.getByRole('button', { name: 'Create client project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Client name').fill('Northstar Labs');
  await page.getByLabel('What problem should this solve?').fill('Teams need a clearer view of project delivery.');
  await page.getByLabel('Who is it for?').fill('Small product teams');
  await page.getByLabel('How will success look?').fill('Fewer missed handoffs');
  await page.getByRole('button', { name: 'Create intake' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(projectName);
  await expect(page.getByText('LOCAL DRAFT · Saved in this browser')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a run' })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(projectName);
  await expect(page.locator('.intake-grid').getByText('Teams need a clearer view of project delivery.')).toBeVisible();
});
