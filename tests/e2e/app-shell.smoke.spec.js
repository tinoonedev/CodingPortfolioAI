import { test, expect } from '@playwright/test';

test('loads the project room and clearly identifies demo-only workflow data @smoke', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Fieldwork — Agentic Product Studio');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Waypoint');
  await expect(page.getByText('DEMO RUN', { exact: true })).toBeVisible();
  await expect(page.getByText('Human confirmation gates every task')).toBeVisible();
  await expect(page.getByText('Demo only: this prototype does not read or write Jira comments.')).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('SEEDED DEMO EVENTS')).toBeVisible();
});
