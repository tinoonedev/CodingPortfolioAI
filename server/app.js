import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DUMMY_PASSWORD_HASH, hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { validateClientProject } from './config.js';

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

export function createWorkspaceApp({ config, pool }) {
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
  app.use(express.json({ limit: '16kb', strict: true }));

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
