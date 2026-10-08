import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { test, expect } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off' });

function configuredPool() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Workspace auth browser tests require a loopback PostgreSQL database.');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false });
}

test('invited accounts persist workspace projects and cannot read another workspace @smoke @sanity', async ({ page }) => {
  test.skip(process.env.WORKSPACE_REAL_INTEGRATION !== '1', 'Requires the real loopback PostgreSQL integration job.');
  const pool = configuredPool();
  const workspaceId = process.env.STUDIO_WORKSPACE_ID;
  const email = `fieldwork+e2e-${randomUUID()}@example.test`;
  const displayName = 'Fieldwork E2E Owner';
  const password = `Fieldwork-${randomBytes(16).toString('base64url')}`;
  const invite = randomBytes(32).toString('base64url');
  const inviteHash = createHash('sha256').update(invite).digest('hex');
  const expiredEmail = `fieldwork+expired-${randomUUID()}@example.test`;
  const expiredInvite = randomBytes(32).toString('base64url');
  const expiredInviteHash = createHash('sha256').update(expiredInvite).digest('hex');
  const unknownEmail = `fieldwork+unknown-${randomUUID()}@example.test`;
  const foreignInviteEmail = `fieldwork+foreign-invite-${randomUUID()}@example.test`;
  const foreignInvite = randomBytes(32).toString('base64url');
  const foreignInviteHash = createHash('sha256').update(foreignInvite).digest('hex');
  const unauthorizedInviteEmail = `fieldwork+unauthorized-${randomUUID()}@example.test`;
  const memberEmail = `fieldwork+member-${randomUUID()}@example.test`;
  const memberPassword = `Fieldwork-${randomBytes(16).toString('base64url')}`;
  const memberSubjectPrefix = 'password:';
  let memberSubject;
  let subject;
  const foreignWorkspaceId = randomUUID();
  const foreignSubject = `integration:${randomUUID()}`;
  const foreignProjectId = randomUUID();

  try {
    await pool.query(
      `INSERT INTO studio_workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [workspaceId, process.env.STUDIO_WORKSPACE_NAME],
    );
    await pool.query(
      `INSERT INTO studio_account_invitations (token_hash, workspace_id, email, role, expires_at)
       VALUES ($1, $2, $3, 'owner', now() + interval '24 hours')`,
      [inviteHash, workspaceId, email],
    );
    await pool.query(
      `INSERT INTO studio_account_invitations (token_hash, workspace_id, email, role, expires_at)
       VALUES ($1, $2, $3, 'member', now() - interval '1 second')`,
      [expiredInviteHash, workspaceId, expiredEmail],
    );
    await pool.query('INSERT INTO studio_workspaces (id, name) VALUES ($1, $2)', [foreignWorkspaceId, 'Integration isolation workspace']);
    await pool.query(
      `INSERT INTO studio_account_invitations (token_hash, workspace_id, email, role, expires_at)
       VALUES ($1, $2, $3, 'member', now() + interval '24 hours')`,
      [foreignInviteHash, foreignWorkspaceId, foreignInviteEmail],
    );

    await page.goto('/');
    const invalidRegistrations = [
      { email: `mismatch+${randomUUID()}@example.test`, inviteToken: invite },
      { email: expiredEmail, inviteToken: expiredInvite },
      { email: unknownEmail, inviteToken: randomBytes(32).toString('base64url') },
      { email: foreignInviteEmail, inviteToken: foreignInvite },
    ];
    for (const registration of invalidRegistrations) {
      const rejected = await page.context().request.post('/api/auth/register', {
        data: { ...registration, displayName, password },
        headers: { origin: 'http://127.0.0.1:4173' },
      });
      expect(rejected.status()).toBe(400);
      expect((await rejected.json()).error.code).toBe('INVALID_INVITATION');
      const absentAccount = await pool.query('SELECT 1 FROM studio_users WHERE lower(email) = $1', [registration.email]);
      expect(absentAccount.rowCount).toBe(0);
    }
    const unauthenticatedSession = await page.context().request.get('/api/session');
    expect(unauthenticatedSession.status()).toBe(401);
    await page.getByRole('button', { name: 'Create an account with an invitation' }).click();
    await page.getByLabel('Display name').fill(displayName);
    await page.getByLabel('Invitation token').fill(invite);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Your studio, in motion.' })).toBeVisible();
    await expect(page.getByText('Your first client project starts with a brief.')).toBeVisible();
    await page.getByRole('button', { name: 'Create your first brief' }).click();
    await expect(page.getByRole('heading', { name: 'Start with the brief.' })).toBeVisible();
    const projectName = `Workspace E2E ${randomUUID().slice(0, 8)}`;
    await page.getByLabel('Project name').fill(projectName);
    await page.getByLabel('Client name').fill('Integration Client');
    await page.getByLabel('Business problem').fill('Verify real PostgreSQL-backed account persistence.');
    await page.getByLabel('Target user').fill('Workspace owner');
    await page.getByLabel('Success signal').fill('The project is restored after a new session.');
    await page.getByLabel('I reviewed and approve this brief for the workspace.').check();
    await page.getByRole('button', { name: 'Create client project' }).click();
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your studio, in motion.' })).toBeVisible();
    const projectChoice = page.getByRole('navigation', { name: 'Client projects' }).getByRole('button', { name: projectName });
    await expect(projectChoice).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { name: projectName, level: 2 })).toHaveCount(0);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasHorizontalOverflow, `horizontal overflow at ${width}px`).toBe(false);
    }
    await projectChoice.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(projectChoice).toBeFocused();
    const focusOutlineWidth = await projectChoice.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth));
    expect(focusOutlineWidth).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Space');
    await expect(projectChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: projectName, level: 2 })).toBeVisible();
    const jiraPanel = page.getByRole('region', { name: 'Jira connection' });
    await expect(jiraPanel).toBeVisible();
    await expect(jiraPanel.getByRole('status')).toHaveText('Not connected');
    const agentPanel = page.getByRole('region', { name: 'Project agent readiness' });
    await expect(agentPanel.getByRole('status')).toHaveText('Setup required');

    const account = await pool.query('SELECT subject FROM studio_users WHERE lower(email) = $1', [email]);
    subject = account.rows[0]?.subject;
    expect(subject).toBeTruthy();
    const sessionCountBeforeRedeemedRetry = await pool.query('SELECT count(*) FROM studio_sessions WHERE user_subject = $1', [subject]);
    const redeemedInviteRetry = await page.context().request.post('/api/auth/register', {
      data: { email, displayName, password, inviteToken: invite },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(redeemedInviteRetry.status()).toBe(400);
    expect((await redeemedInviteRetry.json()).error.code).toBe('INVALID_INVITATION');
    const sessionCountAfterRedeemedRetry = await pool.query('SELECT count(*) FROM studio_sessions WHERE user_subject = $1', [subject]);
    expect(sessionCountAfterRedeemedRetry.rows[0].count).toBe(sessionCountBeforeRedeemedRetry.rows[0].count);
    const projectsBefore = await page.context().request.get('/api/projects');
    expect(projectsBefore.ok()).toBeTruthy();
    const projectBefore = (await projectsBefore.json()).projects.find((project) => project.name === projectName);
    expect(projectBefore).toBeTruthy();
    const agentReadiness = await page.context().request.get(`/api/projects/${projectBefore.id}/agents/openai/readiness`);
    expect(agentReadiness.status()).toBe(200);
    const agentReadinessBody = await agentReadiness.json();
    expect(agentReadinessBody.status).toBe('not_configured');
    expect(agentReadinessBody.canStartRun).toBe(false);
    const openAiConfigurationIntegration = process.env.WORKSPACE_OPENAI_CONFIG_INTEGRATION === '1';
    expect(agentReadinessBody.canConfigure).toBe(openAiConfigurationIntegration);
    expect(agentReadinessBody.projectId).toBe(projectBefore.id);
    expect(JSON.stringify(agentReadinessBody)).not.toMatch(/OPENAI_API_KEY|sk-[A-Za-z0-9_-]{12}|ciphertext|Bearer /i);
    if (openAiConfigurationIntegration) {
      await expect(agentPanel.getByRole('button', { name: 'Save encrypted project settings' })).toBeEnabled();
      const apiKey = `sk-proj-${randomBytes(24).toString('hex')}`;
      await agentPanel.getByLabel('OpenAI project API key').fill(apiKey);
      await agentPanel.getByLabel('Allowed model').selectOption('integration-no-egress');
      await agentPanel.getByRole('button', { name: 'Save encrypted project settings' }).click();
      await expect(agentPanel.getByText(/Project credentials were encrypted and saved/)).toBeVisible();
      await expect(agentPanel.getByLabel('OpenAI project API key')).toHaveValue('');
      const configuredReadiness = await page.context().request.get(`/api/projects/${projectBefore.id}/agents/openai/readiness`);
      expect(configuredReadiness.status()).toBe(200);
      const configuredReadinessBody = await configuredReadiness.json();
      expect(configuredReadinessBody.status).toBe('execution_unavailable');
      expect(configuredReadinessBody.projectConfigured).toBe(true);
      expect(configuredReadinessBody.projectConfigurationValid).toBe(true);
      expect(configuredReadinessBody.canStartRun).toBe(false);
      expect(JSON.stringify(configuredReadinessBody)).not.toContain(apiKey);
      expect(JSON.stringify(configuredReadinessBody)).not.toMatch(/ciphertext|Bearer /i);
      const encryptedConfiguration = await pool.query(
        'SELECT encrypted_credentials, credential_key_id FROM studio_openai_project_configs WHERE workspace_id = $1 AND project_id = $2',
        [workspaceId, projectBefore.id],
      );
      expect(encryptedConfiguration.rowCount).toBe(1);
      expect(JSON.stringify(encryptedConfiguration.rows[0].encrypted_credentials)).not.toContain(apiKey);
      const configurationAudit = await pool.query(
        `SELECT metadata FROM studio_audit_events
         WHERE workspace_id = $1 AND action = 'openai.project_configuration_saved' AND entity_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [workspaceId, projectBefore.id],
      );
      expect(configurationAudit.rowCount).toBe(1);
      expect(configurationAudit.rows[0].metadata).toMatchObject({ credentialEncrypted: true, providerValidated: false, executionEnabled: false });
      expect(JSON.stringify(configurationAudit.rows[0].metadata)).not.toContain(apiKey);
      const pausedAgentRun = await page.context().request.post(`/api/projects/${projectBefore.id}/agents/runs`, {
        data: { role: 'business-analyst', artifact: 'Feature: Project-scoped run readiness' },
        headers: { origin: 'http://127.0.0.1:4173' },
      });
      expect(pausedAgentRun.status()).toBe(503);
      expect((await pausedAgentRun.json()).error.code).toBe('OPENAI_EXECUTION_UNAVAILABLE');
      const runCount = await pool.query('SELECT count(*) FROM studio_agent_runs WHERE workspace_id = $1 AND project_id = $2', [workspaceId, projectBefore.id]);
      expect(runCount.rows[0].count).toBe('0');
    } else {
      await expect(agentPanel.getByRole('button', { name: 'Save encrypted project settings' })).toBeDisabled();
      await expect(agentPanel.getByText('PROJECT_OPENAI_CONFIGURATION', { exact: true })).toBeVisible();
      await expect(agentPanel.getByText('OPENAI_MODEL_PRICING_USD_PER_MILLION', { exact: true })).toBeVisible();
      const blockedAgentRun = await page.context().request.post(`/api/projects/${projectBefore.id}/agents/runs`, {
        data: { role: 'business-analyst', artifact: 'Feature: Project-scoped run readiness' },
        headers: { origin: 'http://127.0.0.1:4173' },
      });
      expect(blockedAgentRun.status()).toBe(503);
      const blockedAgentRunBody = await blockedAgentRun.json();
      expect(blockedAgentRunBody.error.code).toBe('OPENAI_SETUP_REQUIRED');
      expect(blockedAgentRunBody.error.missing).toContain('PROJECT_OPENAI_CONFIGURATION');
      expect(JSON.stringify(blockedAgentRunBody)).not.toMatch(/OPENAI_API_KEY|ciphertext|Bearer |sk-[A-Za-z0-9]{12}/i);
    }
    const jiraStatus = await page.context().request.get(`/api/projects/${projectBefore.id}/jira/connection`);
    expect(jiraStatus.ok()).toBeTruthy();
    const jiraStatusBody = await jiraStatus.json();
    expect(jiraStatusBody.status).toBe('not_connected');
    expect(typeof jiraStatusBody.configured).toBe('boolean');
    expect(jiraStatusBody.connection).toBeNull();
    expect(JSON.stringify(jiraStatusBody)).not.toMatch(/clientSecret|accessToken|refreshToken|ciphertext|private-client/i);
    if (!jiraStatusBody.configured) {
      await expect(jiraPanel.getByText('Jira OAuth setup required')).toBeVisible();
      await expect(jiraPanel.getByText('JIRA_OAUTH_CLIENT_ID', { exact: true })).toBeVisible();
      await jiraPanel.getByRole('button', { name: 'Connect Jira' }).click();
      await expect(jiraPanel.getByRole('alert')).toContainText('Jira OAuth is not configured');
      const jiraAuthorizationStart = await page.context().request.post(`/api/projects/${projectBefore.id}/jira/authorization`, { headers: { origin: 'http://127.0.0.1:4173' } });
      expect(jiraAuthorizationStart.status()).toBe(503);
      const jiraSetup = await jiraAuthorizationStart.json();
      expect(jiraSetup.error.code).toBe('JIRA_SETUP_REQUIRED');
      expect(jiraSetup.error.missing).toContain('JIRA_OAUTH_CLIENT_ID');
      expect(JSON.stringify(jiraSetup)).not.toMatch(/clientSecret|accessToken|refreshToken|ciphertext/i);
      const jiraSites = await page.context().request.get(`/api/projects/${projectBefore.id}/jira/authorization/sites`);
      expect(jiraSites.status()).toBe(503);
      expect((await jiraSites.json()).error.code).toBe('JIRA_SETUP_REQUIRED');
      const jiraProjectSearch = await page.context().request.get(`/api/projects/${projectBefore.id}/jira/authorization/sites/00000000-0000-4000-8000-000000000001/projects`);
      expect(jiraProjectSearch.status()).toBe(503);
      expect((await jiraProjectSearch.json()).error.code).toBe('JIRA_SETUP_REQUIRED');
      const jiraSelection = await page.context().request.post(`/api/projects/${projectBefore.id}/jira/authorization/selection`, {
        data: { cloudId: '00000000-0000-4000-8000-000000000001', jiraProjectId: '10001' },
        headers: { origin: 'http://127.0.0.1:4173' },
      });
      expect(jiraSelection.status()).toBe(503);
      expect((await jiraSelection.json()).error.code).toBe('JIRA_SETUP_REQUIRED');
    } else {
      await expect(jiraPanel.getByRole('button', { name: 'Connect Jira' })).toBeEnabled();
    }
    const invalidJiraCallback = await page.context().request.get(`/api/integrations/jira/callback?state=${randomBytes(32).toString('base64url')}&code=unused`, { maxRedirects: 0 });
    expect(invalidJiraCallback.status()).toBe(303);
    expect(invalidJiraCallback.headers().location).toContain('jira=callback_invalid');
    expect(invalidJiraCallback.headers().location).not.toMatch(/code=|state=/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Your studio starts here.' })).toBeVisible();
    const knownEmailFailure = await page.context().request.post('/api/auth/login', {
      data: { email, password: 'incorrect-password-for-test' },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    const unknownEmailFailure = await page.context().request.post('/api/auth/login', {
      data: { email: `unknown+${randomUUID()}@example.test`, password: 'incorrect-password-for-test' },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(knownEmailFailure.status()).toBe(401);
    expect(unknownEmailFailure.status()).toBe(401);
    expect(await knownEmailFailure.json()).toEqual(await unknownEmailFailure.json());
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Your studio, in motion.' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Client projects' }).getByRole('button', { name: projectName }).click();
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    const projectsAfter = await page.context().request.get('/api/projects');
    const projectAfter = (await projectsAfter.json()).projects.find((project) => project.name === projectName);
    expect(projectAfter?.id).toBe(projectBefore.id);

    await page.getByText('Invite a workspace member').click();
    await page.getByLabel('Email address').fill(memberEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const memberInvite = await page.locator('.workspace-invitation-token code').textContent();
    expect(memberInvite).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const storedInvitation = await pool.query('SELECT token_hash FROM studio_account_invitations WHERE lower(email) = $1', [memberEmail]);
    expect(storedInvitation.rows[0]?.token_hash).toBe(createHash('sha256').update(memberInvite).digest('hex'));

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Your studio starts here.' })).toBeVisible();
    await page.getByRole('button', { name: 'Create an account with an invitation' }).click();
    await page.getByLabel('Display name').fill('Fieldwork E2E Member');
    await page.getByLabel('Invitation token').fill(memberInvite);
    await page.getByLabel('Email address').fill(memberEmail);
    await page.getByLabel('Password').fill(memberPassword);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a project to open its room.' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Client projects' }).getByRole('button', { name: projectName }).click();
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(page.getByText('Invite a workspace member')).toHaveCount(0);
    const memberJiraPanel = page.getByRole('region', { name: 'Jira connection' });
    await expect(memberJiraPanel.getByRole('status')).toHaveText('Not connected');
    await expect(memberJiraPanel.getByText('Only a workspace owner can change this Jira connection.')).toBeVisible();
    await expect(memberJiraPanel.getByRole('button', { name: 'Connect Jira' })).toHaveCount(0);
    const memberJiraAuthorization = await page.context().request.post(`/api/projects/${projectBefore.id}/jira/authorization`, { headers: { origin: 'http://127.0.0.1:4173' } });
    expect(memberJiraAuthorization.status()).toBe(403);
    expect((await memberJiraAuthorization.json()).error.code).toBe('OWNER_REQUIRED');
    const memberOpenAiConfiguration = await page.context().request.put(`/api/projects/${projectBefore.id}/agents/openai/configuration`, {
      data: {},
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(memberOpenAiConfiguration.status()).toBe(403);
    expect((await memberOpenAiConfiguration.json()).error.code).toBe('OWNER_REQUIRED');
    const memberAccount = await pool.query('SELECT subject FROM studio_users WHERE lower(email) = $1', [memberEmail]);
    memberSubject = memberAccount.rows[0]?.subject;
    expect(memberSubject?.startsWith(memberSubjectPrefix)).toBeTruthy();
    const unauthorizedInvitation = await page.context().request.post('/api/auth/invitations', {
      data: { email: unauthorizedInviteEmail, role: 'member' },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(unauthorizedInvitation.status()).toBe(403);
    const absentInvitation = await pool.query('SELECT 1 FROM studio_account_invitations WHERE lower(email) = $1', [unauthorizedInviteEmail]);
    expect(absentInvitation.rowCount).toBe(0);

    await pool.query(
      `INSERT INTO studio_users (subject, email, display_name, email_verified, password_hash)
       VALUES ($1, $2, $3, false, NULL)`,
      [foreignSubject, `foreign+${randomUUID()}@example.test`, 'Foreign Integration User'],
    );
    await pool.query(
      `INSERT INTO studio_workspace_members (workspace_id, user_subject, role) VALUES ($1, $2, 'owner')`,
      [foreignWorkspaceId, foreignSubject],
    );
    await pool.query(
      `INSERT INTO studio_client_projects
         (id, workspace_id, created_by, name, client, problem, target_user, success_signal, brief_approved_at, brief_approved_by)
       VALUES ($1, $2, $3, 'Foreign secret project', 'Private Client', 'Private problem', 'Private user', 'Private signal', now(), $3)`,
      [foreignProjectId, foreignWorkspaceId, foreignSubject],
    );
    const foreignRead = await page.context().request.get(`/api/projects/${foreignProjectId}`);
    expect(foreignRead.status()).toBe(404);
    expect(await foreignRead.text()).not.toContain('Private Client');
    const foreignJiraStatus = await page.context().request.get(`/api/projects/${foreignProjectId}/jira/connection`);
    expect(foreignJiraStatus.status()).toBe(404);
    expect(await foreignJiraStatus.text()).not.toContain('Private Client');
    const foreignAgentReadiness = await page.context().request.get(`/api/projects/${foreignProjectId}/agents/openai/readiness`);
    expect(foreignAgentReadiness.status()).toBe(404);
    expect(await foreignAgentReadiness.text()).not.toContain('Private Client');
    const foreignAgentRun = await page.context().request.post(`/api/projects/${foreignProjectId}/agents/runs`, {
      data: { role: 'business-analyst', artifact: 'Private client content' },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(foreignAgentRun.status()).toBe(404);
    expect(await foreignAgentRun.text()).not.toContain('Private client content');
    const foreignPlanValidation = await page.context().request.post(`/api/projects/${foreignProjectId}/jira-work-plan/validate`, {
      data: { plan: {} },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(foreignPlanValidation.status()).toBe(404);
    expect(await foreignPlanValidation.text()).not.toContain('Private Client');

    await pool.query('DELETE FROM studio_auth_rate_limits');
    const limitedEmail = `fieldwork+limit-${randomUUID()}@example.test`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rejected = await page.context().request.post('/api/auth/login', {
        data: { email: limitedEmail, password: 'incorrect-password-for-test' },
        headers: { origin: 'http://127.0.0.1:4173' },
      });
      expect(rejected.status()).toBe(401);
    }
    const sourceBlockedEmail = `fieldwork+other-${randomUUID()}@example.test`;
    const rateLimited = await page.context().request.post('/api/auth/login', {
      data: { email: sourceBlockedEmail, password: 'incorrect-password-for-test' },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(rateLimited.status()).toBe(429);
    const sourceBlockedEmailBucket = createHash('sha256').update(`email\0${sourceBlockedEmail}`).digest('hex');
    const blockedBucket = await pool.query('SELECT 1 FROM studio_auth_rate_limits WHERE bucket_hash = $1', [sourceBlockedEmailBucket]);
    expect(blockedBucket.rowCount).toBe(0);
  } finally {
    const account = await pool.query('SELECT subject FROM studio_users WHERE lower(email) = $1', [email]).catch(() => ({ rows: [] }));
    subject ||= account.rows[0]?.subject;
    if (subject) {
      await pool.query('DELETE FROM studio_client_projects WHERE workspace_id = $1 AND created_by = $2', [workspaceId, subject]);
      await pool.query('DELETE FROM studio_audit_events WHERE workspace_id = $1 AND actor_subject = $2', [workspaceId, subject]);
      await pool.query('DELETE FROM studio_sessions WHERE user_subject = $1', [subject]);
      await pool.query('DELETE FROM studio_workspace_members WHERE workspace_id = $1 AND user_subject = $2', [workspaceId, subject]);
      await pool.query('DELETE FROM studio_users WHERE subject = $1', [subject]);
    }
    await pool.query(
      'DELETE FROM studio_account_invitations WHERE token_hash = ANY($1::char(64)[]) OR lower(email) = ANY($2::text[])',
      [[inviteHash, expiredInviteHash, foreignInviteHash], [email, expiredEmail, unknownEmail, foreignInviteEmail, unauthorizedInviteEmail]],
    );
    const memberAccount = await pool.query('SELECT subject FROM studio_users WHERE lower(email) = $1', [memberEmail]).catch(() => ({ rows: [] }));
    memberSubject ||= memberAccount.rows[0]?.subject;
    if (memberSubject) {
      await pool.query('DELETE FROM studio_audit_events WHERE workspace_id = $1 AND actor_subject = $2', [workspaceId, memberSubject]);
      await pool.query('DELETE FROM studio_sessions WHERE user_subject = $1', [memberSubject]);
      await pool.query('DELETE FROM studio_workspace_members WHERE workspace_id = $1 AND user_subject = $2', [workspaceId, memberSubject]);
      await pool.query('DELETE FROM studio_users WHERE subject = $1', [memberSubject]);
    }
    await pool.query('DELETE FROM studio_account_invitations WHERE lower(email) = $1', [memberEmail]);
    await pool.query('DELETE FROM studio_workspaces WHERE id = $1', [foreignWorkspaceId]);
    await pool.query('DELETE FROM studio_users WHERE subject = $1', [foreignSubject]);
    await pool.query('DELETE FROM studio_auth_rate_limits');
    await pool.end();
  }
});
