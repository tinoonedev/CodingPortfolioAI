import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DUMMY_PASSWORD_HASH, hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { createPasswordVerificationGate } from './passwordVerificationGate.js';
import { validateClientProject } from './config.js';
import { validateGherkinRequirements } from '../src/domain/gherkinRequirements.js';
import { mapProjectActivityEvent, mapProjectAgentRun } from '../src/domain/projectActivity.js';
import { openAiReadiness, validateAgentTaskInput } from '../src/domain/openaiReadiness.js';
import { encryptOpenAiApiKey, isOpenAiCredentialUsable, isOpenAiModelAllowed, validateOpenAiApiKey } from './openaiCredentials.js';
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
const PROJECT_ACTIVITY_ACTIONS = [
  'client_project.created',
  'client_project.brief_updated',
  'client_project.requirements_saved',
  'jira.authorization_started',
  'jira.authorization_received',
  'jira.project_connected',
  'jira.connection_disconnected',
  'openai.project_configuration_saved',
];

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
    briefApprovedBy: row.approver_display_name || 'Workspace member',
    creationRequestId: row.creation_request_id || null,
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

export function createWorkspaceApp({ config, pool, jiraOAuthConfig = { configured: false, missing: [], invalid: [] }, openAiConfig = { configured: false, missing: ['OPENAI_PROJECT_PROVIDER_CONFIGURATION', 'OPENAI_MODEL_ALLOWLIST', 'OPENAI_SPEND_POLICY'], invalid: [] } }) {
  const app = express();
  const passwordVerificationGate = createPasswordVerificationGate(4);

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
      const incrementBucket = (key) => pool.query(
        `INSERT INTO studio_auth_rate_limits (bucket_hash, attempt_count, window_expires_at)
         VALUES ($1, 1, now() + interval '15 minutes')
         ON CONFLICT (bucket_hash) DO UPDATE SET
           attempt_count = CASE WHEN studio_auth_rate_limits.window_expires_at <= now() THEN 1 ELSE studio_auth_rate_limits.attempt_count + 1 END,
           window_expires_at = CASE WHEN studio_auth_rate_limits.window_expires_at <= now() THEN now() + interval '15 minutes' ELSE studio_auth_rate_limits.window_expires_at END
         RETURNING attempt_count`,
        [key],
      );
      const ipResult = await incrementBucket(keys[0]);
      if (ipResult.rows[0].attempt_count > 10) return false;
      const emailResult = await incrementBucket(keys[1]);
      return emailResult.rows[0].attempt_count <= 10;
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
    const releasePasswordVerification = passwordVerificationGate.tryAcquire();
    if (!releasePasswordVerification) {
      return response.status(429).json({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } });
    }

    let client;
    let sessionToken;
    try {
      const attemptAllowed = await allowLoginAttempt(request, email);
      if (attemptAllowed === null) {
        return response.status(503).json({ error: { code: 'SIGN_IN_UNAVAILABLE', message: 'Sign-in is temporarily unavailable.' } });
      }
      if (!attemptAllowed) {
        return response.status(429).json({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } });
      }
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
      releasePasswordVerification();
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
        `SELECT p.id, p.name, p.client, p.problem, p.target_user, p.success_signal,
                p.brief_approved_at, p.creation_request_id, p.created_at,
                approver.display_name AS approver_display_name
         FROM studio_client_projects p
         LEFT JOIN studio_workspace_members approver_member
           ON approver_member.workspace_id = p.workspace_id AND approver_member.user_subject = p.brief_approved_by
         LEFT JOIN studio_users approver ON approver.subject = approver_member.user_subject
         WHERE p.workspace_id = $1 ORDER BY p.created_at DESC`,
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
      return response.status(400).json({ error: { code: 'INVALID_PROJECT', message: validated.error, field: validated.field } });
    }
    const creationRequestId = request.body?.creationRequestId;
    if (typeof creationRequestId !== 'string' || !UUID_PATTERN.test(creationRequestId)) {
      return response.status(400).json({ error: { code: 'INVALID_CREATION_REQUEST_ID', message: 'A valid creation request identifier is required.', field: 'creationRequestId' } });
    }

    const projectId = randomUUID();
    const creationRequestDigest = sha256(JSON.stringify([
      validated.project.name,
      validated.project.client,
      validated.project.problem,
      validated.project.targetUser,
      validated.project.successSignal,
    ]));
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const insert = await client.query(
        `INSERT INTO studio_client_projects
           (id, workspace_id, created_by, name, client, problem, target_user, success_signal,
            brief_approved_at, brief_approved_by, creation_request_id, creation_request_digest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $3, $9, $10)
         ON CONFLICT (workspace_id, creation_request_id) DO NOTHING
         RETURNING id, name, client, problem, target_user, success_signal, brief_approved_at,
                   brief_approved_by, creation_request_id, created_at`,
        [
          projectId,
          request.workspaceSession.workspace_id,
          request.workspaceSession.user_subject,
          validated.project.name,
          validated.project.client,
          validated.project.problem,
          validated.project.targetUser,
          validated.project.successSignal,
          creationRequestId,
          creationRequestDigest,
        ],
      );
      if (!insert.rows[0]) {
        const existing = await client.query(
          `SELECT p.id, p.name, p.client, p.problem, p.target_user, p.success_signal,
                  p.brief_approved_at, p.brief_approved_by, p.creation_request_id,
                  p.creation_request_digest, p.created_at, approver.display_name AS approver_display_name
           FROM studio_client_projects p
           LEFT JOIN studio_workspace_members approver_member
             ON approver_member.workspace_id = p.workspace_id AND approver_member.user_subject = p.brief_approved_by
           LEFT JOIN studio_users approver ON approver.subject = approver_member.user_subject
           WHERE p.workspace_id = $1 AND p.creation_request_id = $2`,
          [request.workspaceSession.workspace_id, creationRequestId],
        );
        if (!existing.rows[0]) {
          await client.query('ROLLBACK');
          return response.status(503).json({ error: { code: 'PROJECT_OUTCOME_UNCONFIRMED', message: 'The project outcome is not yet confirmed. Check the saved project list before retrying.' } });
        }
        if (existing.rows[0].creation_request_digest.trim() !== creationRequestDigest) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: { code: 'CREATION_REQUEST_ID_REUSED', message: 'This creation request identifier is already bound to different brief content.', field: 'creationRequestId' } });
        }
        await client.query('COMMIT');
        return response.status(200).json({ project: toProject(existing.rows[0]), deduplicated: true });
      }
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id)
         VALUES ($1, $2, 'client_project.created', 'client_project', $3)`,
        [request.workspaceSession.workspace_id, request.workspaceSession.user_subject, projectId],
      );
      await client.query('COMMIT');
      return response.status(201).json({ project: toProject({ ...insert.rows[0], approver_display_name: request.workspaceSession.display_name }) });
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
      return response.status(400).json({ error: { code: 'INVALID_PROJECT', message: validated.error, field: validated.field } });
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
         RETURNING id, name, client, problem, target_user, success_signal, brief_approved_at,
                   brief_approved_by, creation_request_id, created_at`,
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
      return response.json({ project: toProject({ ...updated.rows[0], approver_display_name: request.workspaceSession.display_name }) });
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
        `SELECT p.id, p.name, p.client, p.problem, p.target_user, p.success_signal,
                p.brief_approved_at, p.creation_request_id, p.created_at,
                approver.display_name AS approver_display_name
         FROM studio_client_projects p
         LEFT JOIN studio_workspace_members approver_member
           ON approver_member.workspace_id = p.workspace_id AND approver_member.user_subject = p.brief_approved_by
         LEFT JOIN studio_users approver ON approver.subject = approver_member.user_subject
         WHERE p.id = $1 AND p.workspace_id = $2`,
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

  app.get('/api/projects/:projectId/activity', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    try {
      const project = await pool.query(
        'SELECT id FROM studio_client_projects WHERE id = $1 AND workspace_id = $2',
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!project.rows[0]) {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const [audit, runs] = await Promise.all([
        pool.query(
          `SELECT e.id, e.action, e.created_at, actor.display_name
           FROM studio_audit_events e
           LEFT JOIN studio_users actor ON actor.subject = e.actor_subject
           WHERE e.workspace_id = $1 AND (
             (e.entity_type = 'client_project' AND e.entity_id = $2 AND e.action = ANY($3::text[]))
             OR (e.entity_type = 'requirements_revision' AND e.action = 'client_project.requirements_saved'
               AND EXISTS (
                 SELECT 1 FROM studio_project_requirement_revisions revision
                 WHERE revision.workspace_id = e.workspace_id AND revision.id::text = e.entity_id AND revision.project_id = $2::uuid
               ))
           )
           ORDER BY e.created_at DESC, e.id DESC LIMIT 25`,
          [request.workspaceSession.workspace_id, request.params.projectId, PROJECT_ACTIVITY_ACTIONS],
        ),
        pool.query(
          `SELECT id, role, status, started_at, finished_at
           FROM studio_agent_runs
           WHERE workspace_id = $1 AND project_id = $2
           ORDER BY started_at DESC LIMIT 25`,
          [request.workspaceSession.workspace_id, request.params.projectId],
        ),
      ]);
      return response.json({
        events: audit.rows.map(mapProjectActivityEvent).filter(Boolean),
        agentRuns: runs.rows.map(mapProjectAgentRun).filter(Boolean),
      });
    } catch {
      return response.status(503).json({ error: { code: 'PROJECT_ACTIVITY_UNAVAILABLE', message: 'Project activity could not be loaded. Retry when the workspace is available.' } });
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

  app.get('/api/projects/:projectId/agents/openai/readiness', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    try {
      const project = await pool.query(
        `SELECT p.id, c.model, c.encrypted_credentials, c.credential_key_id, c.monthly_budget_usd, c.max_input_bytes, c.max_output_tokens
         FROM studio_client_projects p LEFT JOIN studio_openai_project_configs c
           ON c.project_id = p.id AND c.workspace_id = p.workspace_id
         WHERE p.id = $1 AND p.workspace_id = $2`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!project.rows[0]) {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const storedConfigurationReady = Boolean(project.rows[0].model);
      const projectModelAllowed = storedConfigurationReady && isOpenAiModelAllowed(openAiConfig.pricing, project.rows[0].model);
      let projectCredentialValid = false;
      if (storedConfigurationReady && openAiConfig.keyring && project.rows[0].encrypted_credentials?.keyId === project.rows[0].credential_key_id) {
        projectCredentialValid = isOpenAiCredentialUsable(
          project.rows[0].encrypted_credentials,
          { workspaceId: request.workspaceSession.workspace_id, projectId: request.params.projectId },
          openAiConfig.keyring,
        );
      }
      const missing = [];
      const invalid = [];
      if (!storedConfigurationReady) missing.push('PROJECT_OPENAI_CONFIGURATION');
      else if (openAiConfig.keyring && !projectCredentialValid) invalid.push('PROJECT_CREDENTIAL_UNAVAILABLE');
      else if (!projectModelAllowed) invalid.push('PROJECT_MODEL_NOT_ALLOWED');
      if ((openAiConfig.missing || []).includes('OPENAI_TOKEN_ENCRYPTION_KEYRING')) missing.push('SERVER_CREDENTIAL_ENCRYPTION');
      if ((openAiConfig.invalid || []).includes('OPENAI_TOKEN_ENCRYPTION_KEYRING')) invalid.push('SERVER_CREDENTIAL_ENCRYPTION');
      if ((openAiConfig.missing || []).includes('OPENAI_MODEL_PRICING_USD_PER_MILLION')) missing.push('OPENAI_MODEL_PRICING_USD_PER_MILLION');
      if ((openAiConfig.invalid || []).includes('OPENAI_MODEL_PRICING_USD_PER_MILLION')) invalid.push('OPENAI_MODEL_PRICING_USD_PER_MILLION');
      const status = !storedConfigurationReady ? 'not_configured' : !openAiConfig.configured ? 'server_setup_required' : !projectCredentialValid ? 'project_credential_invalid' : !projectModelAllowed ? 'project_model_not_allowed' : 'execution_unavailable';
      return response.json({
        provider: 'openai',
        projectId: request.params.projectId,
        status,
        configured: openAiConfig.configured,
        canConfigure: openAiConfig.configured === true,
        projectConfigured: storedConfigurationReady,
        projectConfigurationValid: storedConfigurationReady && projectCredentialValid && projectModelAllowed,
        executionEnabled: false,
        canStartRun: false,
        missing,
        invalid,
        allowedModels: openAiConfig.allowedModels || [],
        projectConfiguration: storedConfigurationReady ? {
          model: project.rows[0].model,
          monthlyBudgetUsd: Number(project.rows[0].monthly_budget_usd),
          maxInputBytes: project.rows[0].max_input_bytes,
          maxOutputTokens: project.rows[0].max_output_tokens,
        } : null,
      });
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Provider readiness could not be checked.' } });
    }
  });

  app.put('/api/projects/:projectId/agents/openai/configuration', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    if (request.workspaceSession.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Only a workspace owner can configure the project agent provider.' } });
    const body = request.body;
    const validFields = new Set(['apiKey', 'model', 'monthlyBudgetUsd', 'maxInputBytes', 'maxOutputTokens']);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((field) => !validFields.has(field))) {
      return response.status(400).json({ error: { code: 'INVALID_OPENAI_CONFIGURATION', message: 'Provide a project API key, allowed model, monthly budget, and request limits.' } });
    }
    const apiKey = validateOpenAiApiKey(body.apiKey);
    const model = typeof body.model === 'string' ? body.model : '';
    const monthlyBudgetUsd = body.monthlyBudgetUsd;
    const maxInputBytes = body.maxInputBytes;
    const maxOutputTokens = body.maxOutputTokens;
    if (!apiKey.valid || !isOpenAiModelAllowed(openAiConfig.pricing, model) || !Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0.01 || monthlyBudgetUsd > 100000 || !Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > 1_000_000 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32000) {
      return response.status(400).json({ error: { code: 'INVALID_OPENAI_CONFIGURATION', message: apiKey.valid ? 'Choose a server-allowed model and valid positive spend and request limits.' : apiKey.error } });
    }
    if (!openAiConfig.keyring || openAiConfig.invalid?.includes('OPENAI_TOKEN_ENCRYPTION_KEYRING')) {
      return response.status(503).json({ error: { code: 'OPENAI_CREDENTIAL_STORAGE_UNAVAILABLE', message: 'Encrypted project credential storage is not configured on this server.' } });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const project = await client.query('SELECT id FROM studio_client_projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [request.params.projectId, request.workspaceSession.workspace_id]);
      if (!project.rows[0]) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const existingConfiguration = await client.query(
        'SELECT settled_spend_usd, reserved_spend_usd FROM studio_openai_project_configs WHERE workspace_id = $1 AND project_id = $2 FOR UPDATE',
        [request.workspaceSession.workspace_id, request.params.projectId],
      );
      if (existingConfiguration.rows[0] && Number(existingConfiguration.rows[0].settled_spend_usd) + Number(existingConfiguration.rows[0].reserved_spend_usd) > monthlyBudgetUsd) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'BUDGET_BELOW_CURRENT_SPEND', message: 'The monthly budget cannot be set below this period’s settled and reserved spend.' } });
      }
      const encryptedCredentials = encryptOpenAiApiKey(apiKey.value, { workspaceId: request.workspaceSession.workspace_id, projectId: request.params.projectId }, openAiConfig.keyring);
      await client.query(
        `INSERT INTO studio_openai_project_configs (workspace_id, project_id, connected_by, encrypted_credentials, credential_key_id, model, monthly_budget_usd, max_input_bytes, max_output_tokens)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, project_id) DO UPDATE SET connected_by = EXCLUDED.connected_by, encrypted_credentials = EXCLUDED.encrypted_credentials,
         credential_key_id = EXCLUDED.credential_key_id, model = EXCLUDED.model, monthly_budget_usd = EXCLUDED.monthly_budget_usd,
         max_input_bytes = EXCLUDED.max_input_bytes, max_output_tokens = EXCLUDED.max_output_tokens, updated_at = now()`,
        [request.workspaceSession.workspace_id, request.params.projectId, request.workspaceSession.user_subject, JSON.stringify(encryptedCredentials), encryptedCredentials.keyId, model, monthlyBudgetUsd, maxInputBytes, maxOutputTokens],
      );
      await client.query(
        `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'openai.project_configuration_saved', 'client_project', $3, $4::jsonb)`,
        [request.workspaceSession.workspace_id, request.workspaceSession.user_subject, request.params.projectId, JSON.stringify({ model, monthlyBudgetUsd, maxInputBytes, maxOutputTokens, credentialEncrypted: true, providerValidated: false, executionEnabled: false })],
      );
      await client.query('COMMIT');
      return response.status(204).end();
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return response.status(503).json({ error: { code: 'OPENAI_CONFIGURATION_UNAVAILABLE', message: 'The project provider configuration could not be saved. No provider request was sent.' } });
    } finally {
      client?.release();
    }
  });

  app.post('/api/projects/:projectId/agents/runs', requireSession, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.projectId)) {
      return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    }
    const input = validateAgentTaskInput(request.body);
    if (!input.valid) {
      return response.status(400).json({ error: { code: 'INVALID_AGENT_TASK', message: input.error } });
    }
    try {
      const project = await pool.query(
        `SELECT p.id, c.model, c.encrypted_credentials, c.credential_key_id, c.max_input_bytes
         FROM studio_client_projects p LEFT JOIN studio_openai_project_configs c
           ON c.project_id = p.id AND c.workspace_id = p.workspace_id
         WHERE p.id = $1 AND p.workspace_id = $2`,
        [request.params.projectId, request.workspaceSession.workspace_id],
      );
      if (!project.rows[0]) {
        return response.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      }
      const configuredInputLimit = project.rows[0].max_input_bytes;
      if (!Number.isInteger(configuredInputLimit) || configuredInputLimit < 1 || configuredInputLimit > 1_000_000) {
        return response.status(503).json({
          error: {
            code: 'OPENAI_SETUP_REQUIRED',
            message: 'OpenAI agent execution is unavailable because the project request limit is missing or invalid.',
            missing: configuredInputLimit == null ? ['PROJECT_OPENAI_CONFIGURATION'] : [],
            invalid: configuredInputLimit == null ? [] : ['PROJECT_REQUEST_LIMITS'],
          },
        });
      }
      const boundedInput = validateAgentTaskInput(request.body, { maxInputBytes: configuredInputLimit });
      if (!boundedInput.valid && boundedInput.code === 'AGENT_INPUT_TOO_LARGE') {
        return response.status(413).json({ error: { code: boundedInput.code, message: boundedInput.error } });
      }
      const safeReadiness = openAiReadiness(openAiConfig);
      const missing = [...safeReadiness.missing];
      const invalid = [...safeReadiness.invalid];
      if ((openAiConfig.missing || []).includes('OPENAI_TOKEN_ENCRYPTION_KEYRING')) missing.push('SERVER_CREDENTIAL_ENCRYPTION');
      if ((openAiConfig.invalid || []).includes('OPENAI_TOKEN_ENCRYPTION_KEYRING')) invalid.push('SERVER_CREDENTIAL_ENCRYPTION');
      if (!project.rows[0].model) missing.unshift('PROJECT_OPENAI_CONFIGURATION');
      else if (!isOpenAiModelAllowed(openAiConfig.pricing, project.rows[0].model)) invalid.push('PROJECT_MODEL_NOT_ALLOWED');
      else if (openAiConfig.keyring && (project.rows[0].encrypted_credentials?.keyId !== project.rows[0].credential_key_id || !isOpenAiCredentialUsable(
        project.rows[0].encrypted_credentials,
        { workspaceId: request.workspaceSession.workspace_id, projectId: request.params.projectId },
        openAiConfig.keyring,
      ))) {
        invalid.push('PROJECT_CREDENTIAL_UNAVAILABLE');
      }
      if (missing.length || invalid.length) {
        return response.status(503).json({
          error: {
            code: 'OPENAI_SETUP_REQUIRED',
            message: 'OpenAI agent execution is unavailable until project credentials, model allowlist, and spend controls are configured.',
            missing,
            invalid,
          },
        });
      }
      const readiness = openAiReadiness({ ...openAiConfig, executionEnabled: false, projectId: request.params.projectId });
      if (!readiness.canStartRun) {
        if (readiness.status === 'execution_unavailable') {
          return response.status(503).json({
            error: {
              code: 'OPENAI_EXECUTION_UNAVAILABLE',
              message: 'OpenAI settings are present, but execution is disabled on this server. No provider request was sent.',
            },
          });
        }
        return response.status(503).json({
          error: {
            code: 'OPENAI_SETUP_REQUIRED',
            message: 'OpenAI agent execution is unavailable until project credentials, model allowlist, and spend controls are configured.',
            missing: readiness.missing,
            invalid: readiness.invalid,
          },
        });
      }
    } catch {
      return response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'The agent task could not be checked.' } });
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
