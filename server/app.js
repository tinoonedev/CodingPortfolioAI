import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DUMMY_PASSWORD_HASH, hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { validateClientProject } from './config.js';
import { validateGherkinRequirements } from '../src/domain/gherkinRequirements.js';
import {
  createWorkPlanDigest,
  createWorkPlanTaskIdempotencyKey,
  orderWorkPlanTasks,
  validateJiraWorkPlan,
} from '../src/domain/jiraWorkPlan.js';
import {
  consumeJiraOAuthTransaction,
  createJiraOAuthTransaction,
  disconnectJiraConnection,
  exchangeJiraAuthorizationCode,
  getJiraConnection,
  purgeExpiredJiraOAuthData,
  listPendingJiraSites,
  searchPendingJiraProjects,
  storePendingJiraAuthorization,
  verifyAndPromotePendingJiraProject,
} from './jiraCredentials.js';

const SESSION_SECONDS = 60 * 60 * 12;
const INVITE_SECONDS = 60 * 60 * 24;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function cookieValue(request, name) {
  const cookieHeader = request.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function appendCookie(response, name, value, options) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path || '/'}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  if (options.secure) attributes.push('Secure');
  response.append('Set-Cookie', attributes.join('; '));
}

function clearCookie(response, name, secure, path = '/') {
  appendCookie(response, name, '', { path, maxAge: 0, secure });
}

function sendSetupRequired(response, config) {
  response.status(503).json({
    error: {
      code: 'SETUP_REQUIRED',
      message: 'The authenticated workspace is not configured.',
      missing: config.missing,
      invalid: config.invalid,
      recovery: 'Configure the listed server settings, then run the database migration.',
    },
  });
}

function toProject(row) {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    problem: row.problem,
    targetUser: row.target_user,
    successSignal: row.success_signal,
    briefApprovedAt: row.brief_approved_at,
    createdAt: row.created_at,
  };
}

function redirectJiraCallback(response, config, outcome, projectId) {
  const target = new URL('/', config.appOrigin);
  target.searchParams.set('jira', outcome);
  if (typeof projectId === 'string' && UUID_PATTERN.test(projectId)) target.searchParams.set('projectId', projectId);
  return response.redirect(303, `${target.pathname}${target.search}`);
}

function projectBriefHash(project) {
  return sha256(JSON.stringify([
    project.name,
    project.client,
    project.problem,
    project.target_user,
    project.success_signal,
  ]));
}

function toRequirementRevision(row, currentBriefHash) {
  return {
    id: row.id,
    revision: row.revision,
    briefChanged: row.brief_hash.trim() !== currentBriefHash,
    content: row.content,
    scenarios: row.scenarios,
    createdAt: row.created_at,
  };
}

export function createWorkspaceApp({ config, pool, jiraOAuthConfig = { configured: false, missing: [], invalid: [] } }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops || false);
  app.use((request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (!config.isDevelopment) {
      response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      response.set('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'");
    }
    next();
  });
  app.use(express.json({ limit: '256kb', strict: true }));

  app.use('/api', (request, response, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.get('origin');
      if (!origin || origin !== config.appOrigin) {
        return response.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed.' } });
      }
    }
    return next();
  });

  const configurationReady = () => config.ready && pool;

  async function findSession(request) {
    const token = cookieValue(request, config.cookieName);
    if (!token || !pool) return null;
    const result = await pool.query(
      `SELECT s.user_subject, s.workspace_id, u.email, u.display_name, w.name AS workspace_name, m.role
       FROM studio_sessions s
       JOIN studio_users u ON u.subject = s.user_subject
       JOIN studio_workspaces w ON w.id = s.workspace_id
       JOIN studio_workspace_members m ON m.workspace_id = s.workspace_id AND m.user_subject = s.user_subject
       WHERE s.token_hash = $1 AND s.expires_at > now() AND m.role IN ('owner', 'member')`,
      [sha256(token)],
    );
    return result.rows[0] || null;
  }

  async function requireSession(request, response, next) {
    if (!configurationReady()) return sendSetupRequired(response, config);
    try {
      const session = await findSession(request);
      if (!session) {
        return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to access this workspace.' } });
      }
      request.workspaceSession = session;
      return next();
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The workspace service is temporarily unavailable.' } });
    }
  }

  function loginAttemptKeys(request, email) {
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    return [sha256(`ip\0${address}`), sha256(`email\0${email}`)];
  }

  async function allowLoginAttempt(request, email) {
    try {
      await pool.query('DELETE FROM studio_auth_rate_limits WHERE window_expires_at <= now()');
      const keys = loginAttemptKeys(request, email);
      const results = await Promise.all(keys.map((key) => pool.query(
        `INSERT INTO studio_auth_rate_limits (bucket_hash, attempt_count, window_expires_at)
         VALUES ($1, 1, now() + interval '15 minutes')
         ON CONFLICT (bucket_hash) DO UPDATE SET
           attempt_count = CASE WHEN studio_auth_rate_limits.window_expires_at <= now() THEN 1 ELSE studio_auth_rate_limits.attempt_count + 1 END,
           window_expires_at = CASE WHEN studio_auth_rate_limits.window_expires_at <= now() THEN now() + interval '15 minutes' ELSE studio_auth_rate_limits.window_expires_at END
         RETURNING attempt_count`,
        [key],
      )));
      return results.every((result) => result.rows[0].attempt_count <= 10);
    } catch {
      return null;
    }
  }

  async function clearLoginAttempts(request, email) {
    await pool.query('DELETE FROM studio_auth_rate_limits WHERE bucket_hash = ANY($1::char(64)[])', [loginAttemptKeys(request, email)]).catch(() => {});
  }

  async function createSession(client, { subject, workspaceId, displayName, email }) {
    const sessionToken = randomBytes(32).toString('base64url');
    await client.query('DELETE FROM studio_sessions WHERE expires_at <= now()');
    await client.query(
      `INSERT INTO studio_sessions (token_hash, user_subject, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
      [sha256(sessionToken), subject, workspaceId, SESSION_SECONDS],
    );
    await client.query(
      `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id)
       VALUES ($1, $2, 'workspace.sign_in', 'workspace', $1::uuid::text)`,
      [workspaceId, subject],
    );
    return sessionToken;
  }

  app.get('/api/session', async (request, response) => {
    if (!configurationReady()) return sendSetupRequired(response, config);
    try {
      const session = await findSession(request);
      if (!session) {
        return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to access this workspace.' } });
      }
      return response.json({
        user: { email: session.email, displayName: session.display_name, role: session.role },
        workspace: { id: session.workspace_id, name: session.workspace_name },
      });
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The workspace service is temporarily unavailable.' } });
    }
  });

  app.post('/api/auth/register', async (request, response) => {
    if (!configurationReady()) return sendSetupRequired(response, config);
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = request.body?.password;
    const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim() : '';
    const inviteToken = request.body?.inviteToken;
    if (!EMAIL_PATTERN.test(email) || email.length > 254 || !displayName || displayName.length > 120 || typeof inviteToken !== 'string' || inviteToken.length < 32 || inviteToken.length > 128) {
      return response.status(400).json({ error: { code: 'INVALID_REGISTRATION', message: 'Enter a valid invitation, email, display name, and password.' } });
    }
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return response.status(400).json({ error: { code: 'INVALID_PASSWORD', message: passwordValidation.error } });
    }
    const attemptAllowed = await allowLoginAttempt(request, email);
    if (attemptAllowed === null) {
      return response.status(503).json({ error: { code: 'REGISTRATION_UNAVAILABLE', message: 'Account creation is temporarily unavailable.' } });
    }
    if (!attemptAllowed) {
      return response.status(429).json({ error: { code: 'REGISTRATION_RATE_LIMITED', message: 'Too many account creation attempts. Try again in 15 minutes.' } });
    }

    let client;
    let sessionToken;
    try {
      const subject = `password:${randomUUID()}`;
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO studio_workspaces (id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [config.workspaceId, config.workspaceName],
      );
      const invitation = await client.query(
        `SELECT workspace_id, role FROM studio_account_invitations
         WHERE token_hash = $1 AND lower(email) = $2 AND expires_at > now() AND redeemed_at IS NULL
         FOR UPDATE`,
        [sha256(inviteToken), email],
      );
      if (!invitation.rows[0] || invitation.rows[0].workspace_id !== config.workspaceId) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'This invitation is invalid, expired, already used, or assigned to another email.' } });
      }
      const passwordHash = await hashPassword(password);
      await client.query(
        `INSERT INTO studio_users (subject, email, display_name, email_verified, password_hash)
         VALUES ($1, $2, $3, false, $4)`,
        [subject, email, displayName, passwordHash],
      );
      await client.query(
        `INSERT INTO studio_workspace_members (workspace_id, user_subject, role)
         VALUES ($1, $2, $3)`,
        [config.workspaceId, subject, invitation.rows[0].role],
      );
      await client.query(
        `UPDATE studio_account_invitations SET redeemed_at = now()
         WHERE token_hash = $1 AND redeemed_at IS NULL`,
        [sha256(inviteToken)],
      );
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id)
         VALUES ($1, $2, 'workspace.account_created', 'user', $2)`,
        [config.workspaceId, subject],
      );
      sessionToken = await createSession(client, { subject, workspaceId: config.workspaceId, displayName, email });
      await client.query('COMMIT');
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (error?.code === '23505') {
        return response.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'An account already exists for this email address.' } });
      }
      return response.status(503).json({ error: { code: 'REGISTRATION_UNAVAILABLE', message: 'The account could not be created. No session was issued.' } });
    } finally {
      client?.release();
    }

    await clearLoginAttempts(request, email);
    appendCookie(response, config.cookieName, sessionToken, { maxAge: SESSION_SECONDS, secure: !config.isDevelopment });
    return response.status(201).json({ registered: true });
  });

  app.post('/api/auth/login', async (request, response) => {
    if (!configurationReady()) return sendSetupRequired(response, config);
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = request.body?.password;
    if (!EMAIL_PATTERN.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 128) {
      return response.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    }
    const attemptAllowed = await allowLoginAttempt(request, email);
    if (attemptAllowed === null) {
      return response.status(503).json({ error: { code: 'SIGN_IN_UNAVAILABLE', message: 'Sign-in is temporarily unavailable.' } });
    }
    if (!attemptAllowed) {
      return response.status(429).json({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } });
    }

    let client;
    let sessionToken;
    try {
      const result = await pool.query(
        `SELECT u.subject, u.display_name, u.password_hash, m.workspace_id, m.role
         FROM studio_users u
         JOIN studio_workspace_members m ON m.user_subject = u.subject
         WHERE lower(u.email) = $1 AND m.workspace_id = $2`,
        [email, config.workspaceId],
      );
      const user = result.rows[0];
      const matches = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
      if (!user || !matches || !['owner', 'member'].includes(user.role)) {
        return response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
      }
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('UPDATE studio_users SET last_login_at = now() WHERE subject = $1', [user.subject]);
      sessionToken = await createSession(client, { subject: user.subject, workspaceId: user.workspace_id, displayName: user.display_name, email });
      await client.query('COMMIT');
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'SIGN_IN_UNAVAILABLE', message: 'Sign-in is temporarily unavailable. No session was created.' } });
    } finally {
      client?.release();
    }

    await clearLoginAttempts(request, email);
    appendCookie(response, config.cookieName, sessionToken, { maxAge: SESSION_SECONDS, secure: !config.isDevelopment });
    return response.status(200).json({ signedIn: true });
  });

  app.post('/api/auth/invitations', requireSession, async (request, response) => {
    if (!['owner'].includes(request.workspaceSession.role)) {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only workspace owners can invite accounts.' } });
    }
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const role = request.body?.role === 'owner' ? 'owner' : 'member';
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return response.status(400).json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } });
    }
    const invitationToken = randomBytes(32).toString('base64url');
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const existing = await client.query('SELECT 1 FROM studio_users WHERE lower(email) = $1', [email]);
      if (existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'An account already exists for this email address.' } });
      }
      await client.query(
        `INSERT INTO studio_account_invitations (token_hash, workspace_id, email, role, expires_at)
         VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))`,
        [sha256(invitationToken), request.workspaceSession.workspace_id, email, role, INVITE_SECONDS],
      );
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'workspace.invitation_created', 'invitation', $3, $4::jsonb)`,
        [request.workspaceSession.workspace_id, request.workspaceSession.user_subject, sha256(invitationToken), JSON.stringify({ email, role })],
      );
      await client.query('COMMIT');
      return response.status(201).json({ invitation: { email, role, token: invitationToken, expiresInSeconds: INVITE_SECONDS } });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'INVITATION_UNAVAILABLE', message: 'The invitation could not be created.' } });
    } finally {
      client?.release();
    }
  });

  app.post('/api/auth/logout', requireSession, async (request, response) => {
    const token = cookieValue(request, config.cookieName);
    try {
      await pool.query('DELETE FROM studio_sessions WHERE token_hash = $1', [sha256(token)]);
      clearCookie(response, config.cookieName, !config.isDevelopment);
      return response.status(204).end();
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The workspace service is temporarily unavailable.' } });
    }
  });

  app.get('/api/projects', requireSession, async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT id, name, client, problem, target_user, success_signal, brief_approved_at, created_at
         FROM studio_client_projects WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [request.workspaceSession.workspace_id],
      );
      return response.json({ projects: result.rows.map(toProject) });
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The workspace service is temporarily unavailable.' } });
    }
  });

  app.post('/api/projects', requireSession, async (request, response) => {
    const validated = validateClientProject(request.body);
    if (!validated.valid) {
      return response.status(400).json({ error: { code: 'INVALID_PROJECT', message: validated.error } });
    }

    const projectId = randomUUID();
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const insert = await client.query(
        `INSERT INTO studio_client_projects
           (id, workspace_id, created_by, name, client, problem, target_user, success_signal, brief_approved_at, brief_approved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $3)
         RETURNING id, name, client, problem, target_user, success_signal, brief_approved_at, created_at`,
        [
          projectId,
          request.workspaceSession.workspace_id,
          request.workspaceSession.user_subject,
          validated.project.name,
          validated.project.client,
          validated.project.problem,
          validated.project.targetUser,
          validated.project.successSignal,
        ],
      );
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id)
         VALUES ($1, $2, 'client_project.created', 'client_project', $3)`,
        [request.workspaceSession.workspace_id, request.workspaceSession.user_subject, projectId],
      );
      await client.query('COMMIT');
      return response.status(201).json({ project: toProject(insert.rows[0]) });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The project could not be saved. Try again after the workspace is available.' } });
    } finally {
      client?.release();
    }
  });

  app.put('/api/projects/:projectId', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can edit a client brief.' } });
    }
    const validated = validateClientProject(request.body);
    if (!validated.valid) {
      return response.status(400).json({ error: { code: 'INVALID_PROJECT', message: validated.error } });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE studio_client_projects SET
           name = $3, client = $4, problem = $5, target_user = $6, success_signal = $7,
           brief_approved_at = now(), brief_approved_by = $8, updated_at = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, name, client, problem, target_user, success_signal, brief_approved_at, created_at`,
        [
          request.params.projectId,
          request.workspaceSession.workspace_id,
          validated.project.name,
          validated.project.client,
          validated.project.problem,
          validated.project.targetUser,
          validated.project.successSignal,
          request.workspaceSession.user_subject,
        ],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id)
         VALUES ($1, $2, 'client_project.brief_updated', 'client_project', $3)`,
        [request.workspaceSession.workspace_id, request.workspaceSession.user_subject, request.params.projectId],
      );
      await client.query('COMMIT');
      return response.json({ project: toProject(updated.rows[0]) });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The brief could not be saved. Try again after the workspace is available.' } });
    } finally {
      client?.release();
    }
  });

  app.get('/api/projects/:projectId', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    try {
      const result = await pool.query(
        `SELECT id, name, client, problem, target_user, success_signal, brief_approved_at, created_at
         FROM studio_client_projects WHERE id = $1 AND workspace_id = $2`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!result.rows[0]) {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      return response.json({ project: toProject(result.rows[0]) });
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The workspace service is temporarily unavailable.' } });
    }
  });

  app.post('/api/projects/:projectId/jira/authorization', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can authorize a Jira connection.' } });
    }
    try {
      const project = await pool.query(
        'SELECT 1 FROM studio_client_projects WHERE id = $1 AND workspace_id = $2',
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!project.rows[0]) {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The workspace service is temporarily unavailable.' } });
    }
    if (jiraOAuthConfig.configured !== true) {
      return response.status(503).json({
        error: {
          code: 'JIRA_SETUP_REQUIRED',
          message: 'Jira OAuth is not configured on this Fieldwork server.',
          missing: jiraOAuthConfig.missing || [],
          invalid: jiraOAuthConfig.invalid || [],
        },
      });
    }
    const sessionToken = cookieValue(request, config.cookieName);
    if (!sessionToken) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to authorize Jira.' } });
    try {
      await purgeExpiredJiraOAuthData(pool);
      const transaction = await createJiraOAuthTransaction(pool, {
        workspaceId: request.workspaceSession.workspace_id,
        projectId: request.params.projectId,
        userSubject: request.workspaceSession.user_subject,
        sessionTokenHash: sha256(sessionToken),
      }, jiraOAuthConfig);
      return response.status(201).json(transaction);
    } catch (error) {
      if (error?.message === 'The project is not available to this workspace owner.') {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      return response.status(503).json({ error: { code: 'JIRA_AUTHORIZATION_UNAVAILABLE', message: 'Jira authorization could not be started.' } });
    }
  });

  app.get('/api/integrations/jira/callback', async (request, response) => {
    let session;
    try {
      session = await findSession(request);
    } catch {
      return redirectJiraCallback(response, config, 'workspace_unavailable');
    }
    if (!session) return redirectJiraCallback(response, config, 'sign_in_required');
    if (session.role !== 'owner') return redirectJiraCallback(response, config, 'owner_required');
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    const providerError = typeof request.query.error === 'string' ? request.query.error : '';
    const sessionToken = cookieValue(request, config.cookieName);
    if (!sessionToken || !state) {
      return redirectJiraCallback(response, config, 'callback_invalid');
    }
    let transaction;
    try {
      transaction = await consumeJiraOAuthTransaction(pool, { state, sessionTokenHash: sha256(sessionToken) });
      if (!transaction) {
        return redirectJiraCallback(response, config, 'callback_invalid');
      }
      if (providerError || !code) {
        return redirectJiraCallback(response, config, 'authorization_denied', transaction.project_id);
      }
      if (jiraOAuthConfig.configured !== true) {
        return redirectJiraCallback(response, config, 'setup_required', transaction.project_id);
      }
      const tokenBundle = await exchangeJiraAuthorizationCode(code, jiraOAuthConfig);
      await storePendingJiraAuthorization(pool, {
        workspaceId: transaction.workspace_id,
        projectId: transaction.project_id,
        userSubject: transaction.user_subject,
        sessionTokenHash: transaction.session_token_hash,
      }, tokenBundle, jiraOAuthConfig.keyring);
      return redirectJiraCallback(response, config, 'authorization_received', transaction.project_id);
    } catch (error) {
      return redirectJiraCallback(response, config, 'authorization_failed', transaction?.project_id);
    }
  });

  app.get('/api/projects/:projectId/jira/authorization/sites', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can choose a Jira site.' } });
    }
    if (jiraOAuthConfig.configured !== true) {
      return response.status(503).json({ error: { code: 'JIRA_SETUP_REQUIRED', message: 'Jira OAuth is not configured on this Fieldwork server.', missing: jiraOAuthConfig.missing || [], invalid: jiraOAuthConfig.invalid || [] } });
    }
    const sessionToken = cookieValue(request, config.cookieName);
    try {
      const sites = await listPendingJiraSites(pool, {
        workspaceId: request.workspaceSession.workspace_id,
        projectId: request.params.projectId,
        userSubject: request.workspaceSession.user_subject,
        sessionTokenHash: sessionToken ? sha256(sessionToken) : '',
      }, jiraOAuthConfig.keyring);
      return response.json({ sites });
    } catch (error) {
      const expired = error?.message === 'The Jira authorization is missing or expired.';
      return response.status(expired ? 410 : 502).json({ error: { code: expired ? 'JIRA_AUTHORIZATION_EXPIRED' : 'JIRA_SITE_LOOKUP_FAILED', message: expired ? 'The pending Jira authorization expired. Start authorization again.' : 'Accessible Jira sites could not be loaded.' } });
    }
  });

  app.get('/api/projects/:projectId/jira/authorization/sites/:cloudId/projects', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can select a Jira project.' } });
    }
    if (jiraOAuthConfig.configured !== true) {
      return response.status(503).json({ error: { code: 'JIRA_SETUP_REQUIRED', message: 'Jira OAuth is not configured on this Fieldwork server.', missing: jiraOAuthConfig.missing || [], invalid: jiraOAuthConfig.invalid || [] } });
    }
    const rawStartAt = request.query.startAt === undefined ? '0' : request.query.startAt;
    const rawMaxResults = request.query.maxResults === undefined ? '25' : request.query.maxResults;
    const rawQuery = request.query.query === undefined ? '' : request.query.query;
    if (typeof rawStartAt !== 'string' || !/^\d{1,5}$/.test(rawStartAt) || typeof rawMaxResults !== 'string' || !/^\d{1,2}$/.test(rawMaxResults) || typeof rawQuery !== 'string' || rawQuery.length > 200) {
      return response.status(400).json({ error: { code: 'INVALID_PROJECT_SEARCH', message: 'Project pagination is invalid.' } });
    }
    const sessionToken = cookieValue(request, config.cookieName);
    try {
      const projects = await searchPendingJiraProjects(pool, {
        workspaceId: request.workspaceSession.workspace_id,
        projectId: request.params.projectId,
        userSubject: request.workspaceSession.user_subject,
        sessionTokenHash: sessionToken ? sha256(sessionToken) : '',
      }, jiraOAuthConfig.keyring, request.params.cloudId, rawQuery, Number(rawStartAt), Number(rawMaxResults));
      return response.json(projects);
    } catch (error) {
      const expired = error?.message === 'The Jira authorization is missing or expired.';
      const invalid = error instanceof TypeError || error?.message === 'The Jira site is not accessible to this pending authorization.';
      return response.status(expired ? 410 : invalid ? 400 : 502).json({ error: { code: expired ? 'JIRA_AUTHORIZATION_EXPIRED' : invalid ? 'INVALID_PROJECT_SEARCH' : 'JIRA_PROJECT_SEARCH_FAILED', message: expired ? 'The pending Jira authorization expired. Start authorization again.' : invalid ? 'Select a site returned by the current Jira authorization.' : 'Jira projects could not be loaded.' } });
    }
  });

  app.post('/api/projects/:projectId/jira/authorization/selection', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can connect a Jira project.' } });
    }
    if (jiraOAuthConfig.configured !== true) {
      return response.status(503).json({ error: { code: 'JIRA_SETUP_REQUIRED', message: 'Jira OAuth is not configured on this Fieldwork server.', missing: jiraOAuthConfig.missing || [], invalid: jiraOAuthConfig.invalid || [] } });
    }
    if (!request.body || Object.keys(request.body).some((key) => !['cloudId', 'jiraProjectId'].includes(key))) {
      return response.status(400).json({ error: { code: 'INVALID_JIRA_SELECTION', message: 'Select one Jira site and project.' } });
    }
    const sessionToken = cookieValue(request, config.cookieName);
    try {
      const connection = await verifyAndPromotePendingJiraProject(pool, {
        workspaceId: request.workspaceSession.workspace_id,
        projectId: request.params.projectId,
        userSubject: request.workspaceSession.user_subject,
        sessionTokenHash: sessionToken ? sha256(sessionToken) : '',
      }, { cloudId: request.body?.cloudId, jiraProjectId: request.body?.jiraProjectId }, jiraOAuthConfig.keyring);
      return response.status(201).json({ connection });
    } catch (error) {
      const expired = error?.message === 'The Jira authorization is missing or expired.' || error?.message === 'The Jira authorization access token has expired.';
      const invalid = error instanceof TypeError || error?.message === 'The Jira site is not accessible to this pending authorization.' || error?.message === 'The selected Jira project could not be verified.';
      return response.status(expired ? 410 : invalid ? 400 : 502).json({ error: { code: expired ? 'JIRA_AUTHORIZATION_EXPIRED' : invalid ? 'JIRA_SELECTION_INVALID' : 'JIRA_SELECTION_FAILED', message: expired ? 'The pending Jira authorization expired. Start authorization again.' : invalid ? 'The selected Jira site or project could not be verified.' : 'The Jira project could not be connected.' } });
    }
  });

  app.get('/api/projects/:projectId/jira/connection', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    try {
      const project = await pool.query(
        'SELECT 1 FROM studio_client_projects WHERE id = $1 AND workspace_id = $2',
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!project.rows[0]) {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const connection = await getJiraConnection(pool, request.workspaceSession.workspace_id, request.params.projectId);
      return response.json({
        configured: jiraOAuthConfig.configured === true,
        setup: { missing: jiraOAuthConfig.missing || [], invalid: jiraOAuthConfig.invalid || [] },
        status: connection?.status || 'not_connected',
        connection,
      });
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The Jira connection status is temporarily unavailable.' } });
    }
  });

  app.post('/api/projects/:projectId/jira/disconnect', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can disconnect Jira.' } });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const project = await client.query(
        'SELECT 1 FROM studio_client_projects WHERE id = $1 AND workspace_id = $2 FOR SHARE',
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!project.rows[0]) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const disconnected = await disconnectJiraConnection(client, request.workspaceSession.workspace_id, request.params.projectId);
      if (disconnected) {
        await client.query(
          `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
           VALUES ($1, $2, 'jira.connection_disconnected', 'client_project', $3, '{"localCredentialsDeleted":true,"providerRevocation":"not_documented"}'::jsonb)`,
          [request.workspaceSession.workspace_id, request.workspaceSession.user_subject, request.params.projectId],
        );
      }
      const connection = await getJiraConnection(client, request.workspaceSession.workspace_id, request.params.projectId);
      await client.query('COMMIT');
      return response.json({
        status: connection?.status || 'not_connected',
        disconnected: Boolean(disconnected),
        connection,
      });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'JIRA_DISCONNECT_UNAVAILABLE', message: 'The local Jira connection could not be disconnected. No disconnect was confirmed.' } });
    } finally {
      client?.release();
    }
  });

  app.get('/api/projects/:projectId/requirements', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const projectResult = await client.query(
        `SELECT id, name, client, problem, target_user, success_signal
         FROM studio_client_projects WHERE id = $1 AND workspace_id = $2`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!projectResult.rows[0]) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const currentHash = projectBriefHash(projectResult.rows[0]);
      const revisions = await client.query(
        `SELECT id, revision, brief_hash, content, scenarios, created_at
         FROM studio_project_requirement_revisions
         WHERE project_id = $1 AND workspace_id = $2
         ORDER BY revision DESC`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      await client.query('COMMIT');
      return response.json({
        revisions: revisions.rows.map((row) => toRequirementRevision(row, currentHash)),
        currentBriefHash: currentHash,
      });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Requirements are temporarily unavailable.' } });
    } finally {
      client?.release();
    }
  });

  app.post('/api/projects/:projectId/requirements', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    if (request.workspaceSession.role !== 'owner') {
      return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can save project requirements.' } });
    }
    const content = request.body?.content;
    const validation = validateGherkinRequirements(content);
    if (!validation.valid) {
      return response.status(400).json({
        error: { code: 'INVALID_GHERKIN', message: 'Requirements need correction before they can be saved as reviewable.' },
        issues: validation.issues,
        reviewable: false,
      });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const projectResult = await client.query(
        `SELECT id, name, client, problem, target_user, success_signal
         FROM studio_client_projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!projectResult.rows[0]) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const project = projectResult.rows[0];
      const currentBriefHash = projectBriefHash(project);
      const nextRevision = await client.query(
        `SELECT COALESCE(MAX(revision), 0) + 1 AS revision
         FROM studio_project_requirement_revisions WHERE workspace_id = $1 AND project_id = $2`,
        [request.workspaceSession.workspace_id, request.params.projectId],
      );
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO studio_project_requirement_revisions
           (id, workspace_id, project_id, revision, brief_hash, content, scenarios, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id, revision, brief_hash, content, scenarios, created_at`,
        [
          id,
          request.workspaceSession.workspace_id,
          request.params.projectId,
          nextRevision.rows[0].revision,
          currentBriefHash,
          content,
          JSON.stringify(validation.scenarios),
          request.workspaceSession.user_subject,
        ],
      );
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'client_project.requirements_saved', 'requirements_revision', $3, $4::jsonb)`,
        [
          request.workspaceSession.workspace_id,
          request.workspaceSession.user_subject,
          id,
          JSON.stringify({ revision: inserted.rows[0].revision, scenarioCount: validation.scenarios.length }),
        ],
      );
      await client.query('COMMIT');
      return response.status(201).json({ revision: toRequirementRevision(inserted.rows[0], currentBriefHash) });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The requirements revision could not be saved.' } });
    } finally {
      client?.release();
    }
  });

  app.post('/api/projects/:projectId/jira-work-plan/validate', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const projectResult = await client.query(
        `SELECT id, name, client, problem, target_user, success_signal
         FROM studio_client_projects WHERE id = $1 AND workspace_id = $2`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!projectResult.rows[0]) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }

      const revisions = await client.query(
        `SELECT id, revision, brief_hash, content, scenarios
         FROM studio_project_requirement_revisions
         WHERE project_id = $1 AND workspace_id = $2
         ORDER BY revision DESC LIMIT 1`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      const latest = revisions.rows[0];
      if (!latest) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'REQUIREMENTS_REQUIRED', message: 'Save reviewable Gherkin requirements before validating a work plan.' } });
      }

      const briefRevisionId = projectBriefHash(projectResult.rows[0]);
      if (latest.brief_hash.trim() !== briefRevisionId) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'STALE_REQUIREMENTS', message: 'The saved Gherkin belongs to an earlier brief. Save a new requirements revision before planning Jira work.' } });
      }

      const requirementRevision = { id: latest.id, revision: latest.revision, scenarios: latest.scenarios };
      const validation = validateJiraWorkPlan(request.body?.plan, requirementRevision);
      if (!validation.valid) {
        await client.query('ROLLBACK');
        return response.status(422).json({
          error: { code: 'INVALID_WORK_PLAN', message: 'The work plan must cover the current Gherkin revision and contain a valid dependency graph.' },
          issues: validation.issues,
          structurallyValid: false,
        });
      }

      const planDigest = createWorkPlanDigest(request.body.plan, {
        briefRevisionId,
        requirementRevisionId: latest.id,
        requirementContent: latest.content,
      });
      const tasks = orderWorkPlanTasks(request.body.plan.tasks).map((task) => ({
        id: task.id,
        title: task.title,
        ownerRole: task.ownerRole,
        scenarioIds: task.scenarioIds,
        dependsOn: task.dependsOn,
        idempotencyKey: createWorkPlanTaskIdempotencyKey(planDigest, task.id),
      }));
      await client.query('COMMIT');
      return response.json({
        structurallyValid: true,
        qaReview: 'not_run',
        requirementRevisionId: latest.id,
        requirementRevision: latest.revision,
        planDigest,
        tasks,
        approval: 'not_approved',
        jiraWrites: 'not_performed',
      });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The work plan could not be validated against the current project revision.' } });
    } finally {
      client?.release();
    }
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
    app.use(express.static(distPath, { index: false, maxAge: '1y', immutable: true }));
    app.get('/{*path}', (_request, response) => response.sendFile(resolve(distPath, 'index.html')));
  }

  app.use((error, _request, response, _next) => {
    if (!response.headersSent) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
      const code = status === 400 ? 'INVALID_REQUEST' : status === 413 ? 'REQUEST_TOO_LARGE' : 'INTERNAL_ERROR';
      const message = status === 413 ? 'Request body is too large.' : status === 400 ? 'The request could not be processed.' : 'The workspace service could not complete the request.';
      response.status(status).json({ error: { code, message } });
    }
  });

  return app;
}
