import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { encryptJiraTokenBundle } from '../../server/jiraCredentials.js';

test.use({ trace: 'off', screenshot: 'off' });

function configuredPool() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Jira disconnect browser tests require a loopback PostgreSQL database.');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false });
}

test('owner disconnect removes only this project credentials and members cannot disconnect @smoke @sanity @regression', async ({ browser }) => {
  test.skip(process.env.WORKSPACE_REAL_INTEGRATION !== '1', 'Requires the real loopback PostgreSQL integration job.');
  const pool = configuredPool();
  const workspaceId = randomUUID();
  const foreignWorkspaceId = randomUUID();
  const ownerSubject = `jira-disconnect-owner:${randomUUID()}`;
  const memberSubject = `jira-disconnect-member:${randomUUID()}`;
  const foreignOwnerSubject = `jira-disconnect-foreign-owner:${randomUUID()}`;
  const ownerToken = randomBytes(32).toString('base64url');
  const memberToken = randomBytes(32).toString('base64url');
  const foreignOwnerToken = randomBytes(32).toString('base64url');
  const ownerProjectId = randomUUID();
  const otherProjectId = randomUUID();
  const foreignProjectId = randomUUID();
  const keyring = { activeKeyId: 'integration-test', keys: new Map([['integration-test', randomBytes(32)]]) };
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const foreignOwnerContext = await browser.newContext();

  async function seedProject(projectId, name, accessToken, refreshToken) {
    const envelope = encryptJiraTokenBundle({ accessToken, refreshToken, expiresAt: new Date(Date.now() + 60_000).toISOString(), scopes: ['read:jira-work'] }, { workspaceId, projectId }, keyring);
    await pool.query(
      `INSERT INTO studio_jira_connections
         (id, workspace_id, project_id, connected_by, cloud_id, site_url, jira_project_id, jira_project_key, encrypted_credentials, credential_key_id, granted_scopes, status)
       VALUES ($1, $2, $3, $4, 'integration-cloud', 'https://example.atlassian.net', $5, $6, $7::jsonb, $8, ARRAY['read:jira-work'], 'connected')`,
      [randomUUID(), workspaceId, projectId, ownerSubject, `${projectId}-jira`, name === 'Primary disconnect project' ? 'DISC' : 'KEEP', JSON.stringify(envelope), envelope.keyId],
    );
    return envelope;
  }

  try {
    await pool.query('INSERT INTO studio_workspaces (id, name) VALUES ($1, $2)', [workspaceId, `Jira disconnect ${workspaceId.slice(0, 8)}`]);
    await pool.query('INSERT INTO studio_workspaces (id, name) VALUES ($1, $2)', [foreignWorkspaceId, `Foreign Jira disconnect ${foreignWorkspaceId.slice(0, 8)}`]);
    await pool.query(
      `INSERT INTO studio_users (subject, email, display_name, email_verified, password_hash)
       VALUES ($1, $2, 'Jira Disconnect Owner', true, NULL), ($3, $4, 'Jira Disconnect Member', true, NULL), ($5, $6, 'Foreign Jira Owner', true, NULL)`,
      [ownerSubject, `${ownerSubject}@example.test`, memberSubject, `${memberSubject}@example.test`, foreignOwnerSubject, `${foreignOwnerSubject}@example.test`],
    );
    await pool.query(
      `INSERT INTO studio_workspace_members (workspace_id, user_subject, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`,
      [workspaceId, ownerSubject, memberSubject, foreignWorkspaceId, foreignOwnerSubject],
    );
    for (const [projectId, name] of [[otherProjectId, 'Secondary disconnect project'], [ownerProjectId, 'Primary disconnect project']]) {
      await pool.query(
        `INSERT INTO studio_client_projects
           (id, workspace_id, created_by, name, client, problem, target_user, success_signal, brief_approved_at, brief_approved_by)
         VALUES ($1, $2, $3, $4, 'Integration Client', 'Verify project scoped Jira disconnect', 'Workspace owner', 'Only selected Jira credentials are deleted', now(), $3)`,
        [projectId, workspaceId, ownerSubject, name],
      );
    }
    const primaryAccess = `access-primary-${randomBytes(18).toString('hex')}`;
    const primaryRefresh = `refresh-primary-${randomBytes(18).toString('hex')}`;
    const secondaryAccess = `access-secondary-${randomBytes(18).toString('hex')}`;
    const secondaryRefresh = `refresh-secondary-${randomBytes(18).toString('hex')}`;
    const primaryEnvelope = await seedProject(ownerProjectId, 'Primary disconnect project', primaryAccess, primaryRefresh);
    const secondaryEnvelope = await seedProject(otherProjectId, 'Secondary disconnect project', secondaryAccess, secondaryRefresh);
    await pool.query(
      `INSERT INTO studio_client_projects
         (id, workspace_id, created_by, name, client, problem, target_user, success_signal, brief_approved_at, brief_approved_by)
       VALUES ($1, $2, $3, 'Foreign disconnect project', 'Foreign Client', 'Verify workspace isolation', 'Foreign owner', 'Connection remains unchanged', now(), $3)`,
      [foreignProjectId, foreignWorkspaceId, foreignOwnerSubject],
    );
    const foreignEnvelope = encryptJiraTokenBundle({
      accessToken: `foreign-access-${randomBytes(20).toString('hex')}`,
      refreshToken: `foreign-refresh-${randomBytes(20).toString('hex')}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scopes: ['read:jira-work'],
    }, { workspaceId: foreignWorkspaceId, projectId: foreignProjectId }, keyring);
    await pool.query(
      `INSERT INTO studio_jira_connections
         (id, workspace_id, project_id, connected_by, cloud_id, site_url, jira_project_id, jira_project_key, encrypted_credentials, credential_key_id, granted_scopes, status)
       VALUES ($1, $2, $3, $4, 'foreign-integration-cloud', 'https://foreign.atlassian.net', 'foreign-project', 'FKEEP', $5::jsonb, $6, ARRAY['read:jira-work'], 'connected')`,
      [randomUUID(), foreignWorkspaceId, foreignProjectId, foreignOwnerSubject, JSON.stringify(foreignEnvelope), foreignEnvelope.keyId],
    );
    await pool.query(
      `INSERT INTO studio_sessions (token_hash, user_subject, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour'), ($4, $5, $3, now() + interval '1 hour'), ($6, $7, $8, now() + interval '1 hour')`,
      [createHash('sha256').update(ownerToken).digest('hex'), ownerSubject, workspaceId, createHash('sha256').update(memberToken).digest('hex'), memberSubject, createHash('sha256').update(foreignOwnerToken).digest('hex'), foreignOwnerSubject, foreignWorkspaceId],
    );
    await ownerContext.addCookies([{ name: 'fieldwork_session', value: ownerToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await memberContext.addCookies([{ name: 'fieldwork_session', value: memberToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await foreignOwnerContext.addCookies([{ name: 'fieldwork_session', value: foreignOwnerToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);

    const page = await ownerContext.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Primary disconnect project' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Jira connection' });
    await expect(panel.getByRole('status')).toHaveText('Connected');
    await expect(panel.getByText('DISC', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Disconnect Jira' }).click();
    const confirmation = panel.getByRole('alertdialog');
    await expect(confirmation).toContainText('delete its stored Jira credentials for this project');
    await expect(confirmation).toContainText('does not revoke the Atlassian account grant');
    await confirmation.getByRole('button', { name: 'Confirm disconnect' }).click();
    await expect(panel.getByRole('status').first()).toHaveText('Disconnected');
    await expect(panel.getByRole('status').nth(1)).toContainText('removed its stored Jira credentials');
    await expect(panel.getByRole('button', { name: 'Disconnect Jira' })).toHaveCount(0);

    const ownerApi = ownerContext.request;
    const disconnectedResponse = await ownerApi.get(`/api/projects/${ownerProjectId}/jira/connection`);
    expect(disconnectedResponse.ok()).toBeTruthy();
    const disconnectedBody = await disconnectedResponse.json();
    expect(disconnectedBody.status).toBe('disconnected');
    expect(disconnectedBody.connection.status).toBe('disconnected');
    expect(JSON.stringify(disconnectedBody)).not.toMatch(/encrypted_credentials|ciphertext|accessToken|refreshToken|access-primary|refresh-primary/i);
    await page.reload();
    await expect(panel.getByRole('status').first()).toHaveText('Disconnected');

    const storedCredentials = await pool.query(
      'SELECT encrypted_credentials, credential_key_id, status FROM studio_jira_connections WHERE workspace_id = $1 AND project_id = $2',
      [workspaceId, ownerProjectId],
    );
    expect(storedCredentials.rows[0]).toEqual({ encrypted_credentials: null, credential_key_id: null, status: 'disconnected' });
    const retainedCredentials = await pool.query(
      'SELECT encrypted_credentials, credential_key_id, status FROM studio_jira_connections WHERE workspace_id = $1 AND project_id = $2',
      [workspaceId, otherProjectId],
    );
    expect(retainedCredentials.rows[0]).toEqual({ encrypted_credentials: secondaryEnvelope, credential_key_id: secondaryEnvelope.keyId, status: 'connected' });

    const auditBeforeRepeat = await pool.query(
      `SELECT count(*)::int AS count FROM studio_audit_events WHERE workspace_id = $1 AND action = 'jira.connection_disconnected' AND entity_id = $2`,
      [workspaceId, ownerProjectId],
    );
    expect(auditBeforeRepeat.rows[0].count).toBe(1);
    const repeatedDisconnect = await ownerApi.post(`/api/projects/${ownerProjectId}/jira/disconnect`, { headers: { origin: 'http://127.0.0.1:4173' } });
    expect(repeatedDisconnect.ok()).toBeTruthy();
    expect(await repeatedDisconnect.json()).toMatchObject({ status: 'disconnected', disconnected: false });
    const auditAfterRepeat = await pool.query(
      `SELECT count(*)::int AS count FROM studio_audit_events WHERE workspace_id = $1 AND action = 'jira.connection_disconnected' AND entity_id = $2`,
      [workspaceId, ownerProjectId],
    );
    expect(auditAfterRepeat.rows[0].count).toBe(1);
    const secondaryStatus = await ownerApi.get(`/api/projects/${otherProjectId}/jira/connection`);
    expect((await secondaryStatus.json()).connection.status).toBe('connected');

    const memberPage = await memberContext.newPage();
    await memberPage.goto('/');
    await expect(memberPage.getByRole('heading', { name: 'Primary disconnect project' })).toBeVisible();
    const memberPanel = memberPage.getByRole('region', { name: 'Jira connection' });
    await expect(memberPanel.getByRole('status').first()).toHaveText('Disconnected');
    await expect(memberPanel.getByRole('button', { name: 'Disconnect Jira' })).toHaveCount(0);
    await memberPage.getByRole('button', { name: /Secondary disconnect project/ }).click();
    await expect(memberPage.getByRole('heading', { name: 'Secondary disconnect project' })).toBeVisible();
    await expect(memberPanel.getByRole('status').first()).toHaveText('Connected');
    await expect(memberPanel.getByRole('button', { name: 'Disconnect Jira' })).toHaveCount(0);
    const memberDisconnect = await memberContext.request.post(`/api/projects/${otherProjectId}/jira/disconnect`, { headers: { origin: 'http://127.0.0.1:4173' } });
    expect(memberDisconnect.status()).toBe(403);
    expect((await memberDisconnect.json()).error.code).toBe('OWNER_REQUIRED');
    const foreignDisconnect = await foreignOwnerContext.request.post(`/api/projects/${otherProjectId}/jira/disconnect`, { headers: { origin: 'http://127.0.0.1:4173' } });
    expect(foreignDisconnect.status()).toBe(404);
    expect((await foreignDisconnect.json()).error.code).toBe('PROJECT_NOT_FOUND');
    const foreignConnection = await pool.query(
      'SELECT encrypted_credentials, credential_key_id, status FROM studio_jira_connections WHERE workspace_id = $1 AND project_id = $2',
      [foreignWorkspaceId, foreignProjectId],
    );
    expect(foreignConnection.rows[0]).toEqual({ encrypted_credentials: foreignEnvelope, credential_key_id: foreignEnvelope.keyId, status: 'connected' });
    await page.close();
    await memberPage.close();
    await foreignOwnerContext.close();
    expect(JSON.stringify({ primaryEnvelope, secondaryEnvelope })).not.toContain(primaryAccess);
  } finally {
    await ownerContext.close();
    await memberContext.close();
    await foreignOwnerContext.close();
    await pool.query('DELETE FROM studio_workspaces WHERE id = $1', [workspaceId]);
    await pool.query('DELETE FROM studio_workspaces WHERE id = $1', [foreignWorkspaceId]);
    await pool.end();
  }
});
