import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test, expect } from '@playwright/test';
import { hashPassword } from '../../server/passwords.js';

test('owner saves Gherkin revisions, receives parser feedback, and sees brief changes @smoke @sanity @regression', async ({ page }) => {
  test.skip(process.env.WORKSPACE_REAL_INTEGRATION !== '1', 'Requires the real loopback PostgreSQL workspace integration.');
  const connectionString = process.env.DATABASE_URL || '';
  const database = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) {
    throw new Error('Gherkin revision browser tests require a loopback PostgreSQL database.');
  }
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
  const workspaceId = process.env.STUDIO_WORKSPACE_ID;
  const subject = `gherkin-e2e:${randomUUID()}`;
  let memberSubject;
  const email = `fieldwork+gherkin-${randomUUID()}@example.test`;
  const password = `Fieldwork-${randomUUID()}-Strong`;
  let projectId;

  try {
    await pool.query(
      `INSERT INTO studio_workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [workspaceId, process.env.STUDIO_WORKSPACE_NAME],
    );
    await pool.query(
      `INSERT INTO studio_users (subject, email, display_name, email_verified, password_hash)
       VALUES ($1, $2, 'Gherkin E2E Owner', false, $3)`,
      [subject, email, await hashPassword(password)],
    );
    await pool.query(
      `INSERT INTO studio_workspace_members (workspace_id, user_subject, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, subject],
    );

    await page.goto('/');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Start with the brief.' })).toBeVisible();
    await page.getByLabel('Project name').fill(`Gherkin E2E ${randomUUID()}`);
    await page.getByLabel('Client name').fill('Fieldwork test tenant');
    await page.getByLabel('Business problem').fill('The owner needs versioned requirements.');
    await page.getByLabel('Target user').fill('Workspace owner');
    await page.getByLabel('Success signal').fill('A saved revision can be read back.');
    await page.getByLabel('I reviewed and approve this brief for the workspace.').check();
    await page.getByRole('button', { name: 'Create client project' }).click();
    await expect(page.getByRole('heading', { name: /Gherkin E2E/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requirements revisions' })).toBeVisible();
    const projectResponse = await page.context().request.get('/api/projects');
    const projects = (await projectResponse.json()).projects;
    projectId = projects.find((project) => project.name.startsWith('Gherkin E2E'))?.id;
    expect(projectId).toBeTruthy();

    const validGherkin = `Feature: Persist client requirements
  As a workspace owner
  I want to save versioned Gherkin requirements
  So that reviewed work keeps its scope

  Rule: Saved requirements belong to the approved project brief
    Scenario: Owner saves a complete revision
      Given the owner has an approved client brief
      When the owner saves a complete Gherkin revision
      Then Fieldwork stores and displays its scenario
`;
    const editor = page.getByLabel('Gherkin feature');
    await editor.fill(validGherkin);
    await page.getByRole('button', { name: 'Validate and save revision' }).click();
    await expect(page.getByRole('status')).toContainText('Revision 1 saved with 1 scenarios');
    await expect(page.getByText('QA review has not been recorded.')).toBeVisible();
    await page.locator('.requirements-history details summary').first().click();
    await expect(page.getByText('scenario-', { exact: false })).toBeVisible();

    const saved = await page.context().request.get(`/api/projects/${projectId}/requirements`);
    expect(saved.status()).toBe(200);
    const savedRevision = (await saved.json()).revisions[0];
    expect(savedRevision.content).toBe(validGherkin);
    expect(savedRevision.revision).toBe(1);
    expect(savedRevision.briefChanged).toBe(false);

    await editor.fill('Feature: Invalid requirements\n  Scenario: Missing a precondition\n    When the owner saves\n    Then Fieldwork returns an error');
    await page.getByRole('button', { name: 'Validate and save revision' }).click();
    await expect(page.getByRole('alert')).toContainText('needs an explicit given step');
    await expect(page.getByText('1 REVISION')).toBeVisible();
    const afterInvalid = await page.context().request.get(`/api/projects/${projectId}/requirements`);
    expect((await afterInvalid.json()).revisions).toHaveLength(1);

    await page.getByRole('button', { name: 'Edit approved brief' }).click();
    await page.getByLabel('Business problem').fill('The owner needs versioned requirements and change history.');
    await page.getByLabel('I approve this updated brief.').check();
    await page.getByRole('button', { name: 'Save approved brief' }).click();
    await expect(page.getByText('PRIOR BRIEF')).toBeVisible();
    await page.locator('.requirements-history details summary').first().click();
    await expect(page.getByText('This revision was saved for a prior brief.')).toBeVisible();

    await editor.fill(validGherkin.replace('complete revision', 'second revision'));
    await page.getByRole('button', { name: 'Validate and save revision' }).click();
    await expect(page.getByRole('status')).toContainText('Revision 2 saved with 1 scenarios');
    const finalState = await page.context().request.get(`/api/projects/${projectId}/requirements`);
    const revisions = (await finalState.json()).revisions;
    expect(revisions.map((revision) => revision.revision)).toEqual([2, 1]);
    expect(revisions[0].briefChanged).toBe(false);
    expect(revisions[1].briefChanged).toBe(true);

    memberSubject = `gherkin-e2e-member:${randomUUID()}`;
    const memberEmail = `fieldwork+gherkin-member-${randomUUID()}@example.test`;
    const memberPassword = `Fieldwork-${randomUUID()}-Member`;
    await pool.query(
      `INSERT INTO studio_users (subject, email, display_name, email_verified, password_hash)
       VALUES ($1, $2, 'Gherkin E2E Member', false, $3)`,
      [memberSubject, memberEmail, await hashPassword(memberPassword)],
    );
    await pool.query(
      `INSERT INTO studio_workspace_members (workspace_id, user_subject, role) VALUES ($1, $2, 'member')`,
      [workspaceId, memberSubject],
    );
    const memberLogin = await page.context().request.post('/api/auth/login', {
      data: { email: memberEmail, password: memberPassword },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(memberLogin.status()).toBe(200);
    const memberWrite = await page.context().request.post(`/api/projects/${projectId}/requirements`, {
      data: { content: validGherkin },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(memberWrite.status()).toBe(403);
    const memberBriefEdit = await page.context().request.put(`/api/projects/${projectId}`, {
      data: { name: 'Unauthorized edit', client: 'Fieldwork test tenant', problem: 'Unauthorized', targetUser: 'Workspace owner', successSignal: 'Must remain unchanged', approved: true },
      headers: { origin: 'http://127.0.0.1:4173' },
    });
    expect(memberBriefEdit.status()).toBe(403);
    const afterDeniedWrite = await page.context().request.get(`/api/projects/${projectId}/requirements`);
    expect((await afterDeniedWrite.json()).revisions).toHaveLength(2);
  } finally {
    if (projectId) {
      await pool.query('DELETE FROM studio_client_projects WHERE id = $1 AND workspace_id = $2', [projectId, workspaceId]).catch(() => {});
    }
    await pool.query('DELETE FROM studio_audit_events WHERE actor_subject = $1', [subject]).catch(() => {});
    await pool.query('DELETE FROM studio_workspace_members WHERE user_subject = $1', [subject]).catch(() => {});
    await pool.query('DELETE FROM studio_users WHERE subject = $1', [subject]).catch(() => {});
    if (memberSubject) {
      await pool.query('DELETE FROM studio_audit_events WHERE actor_subject = $1', [memberSubject]).catch(() => {});
      await pool.query('DELETE FROM studio_workspace_members WHERE user_subject = $1', [memberSubject]).catch(() => {});
      await pool.query('DELETE FROM studio_users WHERE subject = $1', [memberSubject]).catch(() => {});
    }
    await pool.end();
  }
});
