import { test, expect } from '@playwright/test';

test('loads the seeded project room and identifies demo-only workflow data @smoke', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Fieldwork — Agentic Product Studio');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Waypoint');
  await expect(page.getByText('DEMO RUN', { exact: true })).toBeVisible();
  await expect(page.getByText('Activity is auditable. Human approval required for scope changes & production release.')).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('SEEDED DEMO EVENTS')).toBeVisible();
});
