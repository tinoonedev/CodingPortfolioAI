import { test, expect } from '@playwright/test';

test('workspace API blocks session access until real services are configured @sanity', async ({ request }) => {
  test.skip(process.env.WORKSPACE_REAL_INTEGRATION === '1', 'Configured PostgreSQL is exercised by the password account sanity scenario.');
  const response = await request.get('/api/session');

  expect(response.status()).toBe(503);
  const result = await response.json();
  expect(result.error.code).toBe('SETUP_REQUIRED');
  expect(result.error.missing).toContain('DATABASE_URL');
});
