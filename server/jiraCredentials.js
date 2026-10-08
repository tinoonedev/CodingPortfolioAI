import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CALLBACK_PATH = '/api/integrations/jira/callback';
const JIRA_AUTHORIZATION_ENDPOINT = 'https://auth.atlassian.com/authorize';
const JIRA_TOKEN_ENDPOINT = 'https://auth.atlassian.com/oauth/token';
export const JIRA_OAUTH_SCOPES = Object.freeze(['read:jira-work', 'write:jira-work', 'offline_access']);
const KEY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ENVELOPE_FIELDS = new Set(['version', 'keyId', 'iv', 'ciphertext', 'tag']);
const TOKEN_FIELDS = new Set(['accessToken', 'refreshToken', 'expiresAt', 'scopes']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseKeyring(raw, invalid) {
  if (!raw?.trim()) return null;
  if (raw.length > 16_384) {
    invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.keys) || !KEY_ID_PATTERN.test(parsed.activeKeyId || '')) {
      invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
      return null;
    }
    const entries = Object.entries(parsed.keys);
    if (entries.length === 0 || entries.length > 8) {
      invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
      return null;
    }
    const keys = new Map();
    for (const [keyId, encodedKey] of entries) {
      if (!KEY_ID_PATTERN.test(keyId) || typeof encodedKey !== 'string') {
        invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
        return null;
      }
      const key = Buffer.from(encodedKey, 'base64');
      if (key.length !== 32 || key.toString('base64') !== encodedKey) {
        invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
        return null;
      }
      keys.set(keyId, key);
    }
    if (!keys.has(parsed.activeKeyId)) {
      invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
      return null;
    }
    return Object.freeze({ activeKeyId: parsed.activeKeyId, keys });
  } catch {
    invalid.push('JIRA_TOKEN_ENCRYPTION_KEYRING');
    return null;
  }
}

export function readJiraOAuthConfig(env = process.env) {
  const missing = [];
  const invalid = [];
  const names = ['JIRA_OAUTH_CLIENT_ID', 'JIRA_OAUTH_CLIENT_SECRET', 'JIRA_OAUTH_REDIRECT_URI', 'JIRA_TOKEN_ENCRYPTION_KEYRING'];
  for (const name of names) if (!env[name]?.trim()) missing.push(name);

  const isDevelopment = env.NODE_ENV !== 'production';
  const appOrigin = (env.APP_ORIGIN || (isDevelopment ? 'http://127.0.0.1:4173' : '')).trim();
  const redirectUri = env.JIRA_OAUTH_REDIRECT_URI?.trim() || '';
  const clientId = env.JIRA_OAUTH_CLIENT_ID?.trim() || '';
  const clientSecret = env.JIRA_OAUTH_CLIENT_SECRET?.trim() || '';
  const keyring = parseKeyring(env.JIRA_TOKEN_ENCRYPTION_KEYRING || '', invalid);

  if (clientId.length > 512 || clientSecret.length > 4096) invalid.push(clientId.length > 512 ? 'JIRA_OAUTH_CLIENT_ID' : 'JIRA_OAUTH_CLIENT_SECRET');
  if (redirectUri) {
    try {
      const parsedRedirect = new URL(redirectUri);
      const parsedOrigin = new URL(appOrigin);
      const allowedProtocol = parsedRedirect.protocol === 'https:' || (isDevelopment && parsedRedirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedRedirect.hostname));
      if (!allowedProtocol || parsedRedirect.origin !== parsedOrigin.origin || parsedRedirect.pathname !== CALLBACK_PATH || parsedRedirect.search || parsedRedirect.hash || parsedRedirect.username || parsedRedirect.password) {
        invalid.push('JIRA_OAUTH_REDIRECT_URI');
      }
    } catch {
      invalid.push('JIRA_OAUTH_REDIRECT_URI');
    }
  }

  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing: [...new Set(missing)],
    invalid: [...new Set(invalid)],
    clientId,
    clientSecret,
    redirectUri,
    keyring,
  };
}

function associatedData({ workspaceId, projectId }) {
  if (typeof workspaceId !== 'string' || typeof projectId !== 'string' || !workspaceId || !projectId) {
    throw new TypeError('Workspace and project identifiers are required for credential encryption.');
  }
  return Buffer.from(`fieldwork:jira:workspace:${workspaceId}:project:${projectId}:v1`, 'utf8');
}

function safeTokenBundle(bundle) {
  if (!isRecord(bundle) || typeof bundle.accessToken !== 'string' || !bundle.accessToken || typeof bundle.refreshToken !== 'string' || !bundle.refreshToken) {
    throw new TypeError('A Jira access and refresh token bundle is required.');
  }
  for (const field of Object.keys(bundle)) {
    if (!TOKEN_FIELDS.has(field)) throw new TypeError('The Jira token bundle contains an unsupported field.');
  }
  if (bundle.expiresAt !== undefined && (typeof bundle.expiresAt !== 'string' || !Number.isFinite(Date.parse(bundle.expiresAt)))) {
    throw new TypeError('The Jira access-token expiry must be a valid timestamp.');
  }
  if (bundle.scopes !== undefined && (!Array.isArray(bundle.scopes) || bundle.scopes.some((scope) => typeof scope !== 'string'))) {
    throw new TypeError('Granted Jira scopes must be a list of strings.');
  }
  return bundle;
}

function keyFor(keyring, keyId) {
  const key = keyring?.keys?.get(keyId);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Jira credential key is unavailable.');
  return key;
}

export function encryptJiraTokenBundle(bundle, context, keyring) {
  safeTokenBundle(bundle);
  const keyId = keyring?.activeKeyId;
  if (!KEY_ID_PATTERN.test(keyId || '')) throw new Error('Jira credential encryption is not configured.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(keyring, keyId), iv);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  return {
    version: 1,
    keyId,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptJiraTokenBundle(envelope, context, keyring) {
  try {
    if (!isRecord(envelope) || Object.keys(envelope).some((field) => !ENVELOPE_FIELDS.has(field)) || Object.keys(envelope).length !== ENVELOPE_FIELDS.size || envelope.version !== 1 || !KEY_ID_PATTERN.test(envelope.keyId || '')) {
      throw new Error('invalid envelope');
    }
    const iv = Buffer.from(envelope.iv, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || !ciphertext.length || tag.length !== 16 || iv.toString('base64') !== envelope.iv || tag.toString('base64') !== envelope.tag || ciphertext.toString('base64') !== envelope.ciphertext) {
      throw new Error('invalid envelope data');
    }
    const decipher = createDecipheriv('aes-256-gcm', keyFor(keyring, envelope.keyId), iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return safeTokenBundle(JSON.parse(plaintext));
  } catch {
    throw new Error('Jira credential decryption failed.');
  }
}

export function reencryptJiraTokenBundle(envelope, context, keyring) {
  const bundle = decryptJiraTokenBundle(envelope, context, keyring);
  if (envelope.keyId === keyring?.activeKeyId) return envelope;
  return encryptJiraTokenBundle(bundle, context, keyring);
}

export async function upsertJiraConnection(pool, input) {
  const { workspaceId, projectId, ownerSubject, cloudId, siteUrl, jiraProjectId, jiraProjectKey, encryptedCredentials, scopes, accessTokenExpiresAt } = input || {};
  if (![workspaceId, projectId, ownerSubject, cloudId, siteUrl, jiraProjectId, jiraProjectKey].every((value) => typeof value === 'string' && value.trim())) {
    throw new TypeError('Verified Jira site, project, owner, and Fieldwork project identifiers are required.');
  }
  if (!isRecord(encryptedCredentials) || encryptedCredentials.version !== 1 || !KEY_ID_PATTERN.test(encryptedCredentials.keyId || '') || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
    throw new TypeError('An encrypted credential envelope and verified granted scopes are required.');
  }
  const result = await pool.query(
    `INSERT INTO studio_jira_connections
       (id, workspace_id, project_id, connected_by, cloud_id, site_url, jira_project_id, jira_project_key, encrypted_credentials, credential_key_id, granted_scopes, access_token_expires_at, status)
     SELECT gen_random_uuid(), p.workspace_id, p.id, m.user_subject, $4, $5, $6, $7, $8::jsonb, $9, $10::text[], $11, 'connected'
     FROM studio_client_projects p
     JOIN studio_workspace_members m ON m.workspace_id = p.workspace_id AND m.user_subject = $3 AND m.role = 'owner'
     WHERE p.workspace_id = $1 AND p.id = $2
     ON CONFLICT (workspace_id, project_id) DO UPDATE SET
       connected_by = EXCLUDED.connected_by,
       cloud_id = EXCLUDED.cloud_id,
       site_url = EXCLUDED.site_url,
       jira_project_id = EXCLUDED.jira_project_id,
       jira_project_key = EXCLUDED.jira_project_key,
       encrypted_credentials = EXCLUDED.encrypted_credentials,
       credential_key_id = EXCLUDED.credential_key_id,
       granted_scopes = EXCLUDED.granted_scopes,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       status = 'connected',
       updated_at = now()
     RETURNING id, workspace_id, project_id, cloud_id, site_url, jira_project_id, jira_project_key, granted_scopes, access_token_expires_at, status, created_at, updated_at`,
    [workspaceId, projectId, ownerSubject, cloudId, siteUrl, jiraProjectId, jiraProjectKey, JSON.stringify(encryptedCredentials), encryptedCredentials.keyId, scopes, accessTokenExpiresAt],
  );
  if (!result.rows[0]) throw new Error('The project is not available to this workspace owner.');
  return result.rows[0];
}

export async function getJiraConnection(pool, workspaceId, projectId) {
  const result = await pool.query(
    `SELECT id, workspace_id, project_id, cloud_id, site_url, jira_project_id, jira_project_key,
            granted_scopes, access_token_expires_at, status, created_at, updated_at
     FROM studio_jira_connections WHERE workspace_id = $1 AND project_id = $2`,
    [workspaceId, projectId],
  );
  return result.rows[0] || null;
}

export async function getEncryptedJiraCredentials(pool, workspaceId, projectId) {
  const result = await pool.query(
    `SELECT encrypted_credentials, credential_key_id
     FROM studio_jira_connections WHERE workspace_id = $1 AND project_id = $2 AND status = 'connected'`,
    [workspaceId, projectId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { envelope: row.encrypted_credentials, keyId: row.credential_key_id };
}

export async function disconnectJiraConnection(pool, workspaceId, projectId) {
  const result = await pool.query(
    `UPDATE studio_jira_connections
     SET status = 'disconnected', encrypted_credentials = NULL, credential_key_id = NULL, updated_at = now()
     WHERE workspace_id = $1 AND project_id = $2
     RETURNING id, workspace_id, project_id, cloud_id, site_url, jira_project_id, jira_project_key, status, updated_at`,
    [workspaceId, projectId],
  );
  return result.rows[0] || null;
}


const hashState = (value) => createHash('sha256').update(value).digest('hex');

export function buildJiraAuthorizationUrl({ clientId, redirectUri, state }) {
  if (typeof clientId !== 'string' || !clientId || typeof redirectUri !== 'string' || !redirectUri || typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
    throw new TypeError('Valid Jira OAuth client, callback, and state are required.');
  }
  const url = new URL(JIRA_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', JIRA_OAUTH_SCOPES.join(' '));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function createJiraOAuthTransaction(pool, context, oauthConfig) {
  const { workspaceId, projectId, userSubject, sessionTokenHash } = context || {};
  if (![workspaceId, projectId, userSubject, sessionTokenHash].every((value) => typeof value === 'string' && value.trim())) {
    throw new TypeError('An authenticated owner session and project scope are required.');
  }
  if (oauthConfig?.configured !== true) throw new Error('Jira OAuth is not configured.');
  const state = randomBytes(32).toString('base64url');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM studio_jira_pending_authorizations WHERE workspace_id = $1 AND project_id = $2', [workspaceId, projectId]);
    const result = await client.query(
      `INSERT INTO studio_jira_oauth_transactions
         (state_hash, workspace_id, project_id, user_subject, session_token_hash, expires_at)
       SELECT $1, p.workspace_id, p.id, m.user_subject, $4, now() + interval '10 minutes'
       FROM studio_client_projects p
       JOIN studio_workspace_members m ON m.workspace_id = p.workspace_id AND m.user_subject = $3 AND m.role = 'owner'
       WHERE p.workspace_id = $2 AND p.id = $5
       ON CONFLICT (workspace_id, project_id, session_token_hash) DO UPDATE SET
         state_hash = EXCLUDED.state_hash, user_subject = EXCLUDED.user_subject,
         created_at = now(), expires_at = EXCLUDED.expires_at`,
      [hashState(state), workspaceId, userSubject, sessionTokenHash, projectId],
    );
    if (result.rowCount !== 1) throw new Error('The project is not available to this workspace owner.');
    await client.query(
      `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'jira.authorization_started', 'client_project', $3, '{"scope":"pending_site_project_selection"}'::jsonb)`,
      [workspaceId, userSubject, projectId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { state, authorizationUrl: buildJiraAuthorizationUrl({ clientId: oauthConfig.clientId, redirectUri: oauthConfig.redirectUri, state }) };
}

export async function consumeJiraOAuthTransaction(pool, { state, sessionTokenHash }) {
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || typeof sessionTokenHash !== 'string') return null;
  const result = await pool.query(
    `DELETE FROM studio_jira_oauth_transactions
     WHERE state_hash = $1 AND session_token_hash = $2 AND expires_at > now()
     RETURNING workspace_id, project_id, user_subject, session_token_hash`,
    [hashState(state), sessionTokenHash],
  );
  return result.rows[0] || null;
}

export async function exchangeJiraAuthorizationCode(code, oauthConfig) {
  if (typeof code !== 'string' || !code || code.length > 4096 || oauthConfig?.configured !== true) {
    throw new Error('Jira authorization code exchange could not be started.');
  }
  let response;
  try {
    response = await fetch(JIRA_TOKEN_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        code,
        redirect_uri: oauthConfig.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Atlassian token exchange is unavailable.');
  }
  if (!response.ok) throw new Error('Atlassian rejected the Jira authorization code.');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Atlassian returned an invalid token response.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Atlassian returned an invalid token response.');
  const responseChunks = [];
  let responseSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseSize += value.byteLength;
      if (responseSize > 65_536) {
        await reader.cancel();
        throw new Error('Atlassian returned an invalid token response.');
      }
      responseChunks.push(Buffer.from(value));
    }
  } catch {
    throw new Error('Atlassian returned an invalid token response.');
  }
  const bodyText = Buffer.concat(responseChunks).toString('utf8');
  let body;
  try { body = JSON.parse(bodyText); } catch { throw new Error('Atlassian returned an invalid token response.'); }
  const scopes = typeof body.scope === 'string' ? [...new Set(body.scope.split(/\s+/).filter(Boolean))] : [];
  const requiredScopes = JIRA_OAUTH_SCOPES;
  if (typeof body.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string' || !body.refresh_token || !Number.isInteger(body.expires_in) || body.expires_in < 1 || body.expires_in > 31_536_000 || requiredScopes.some((scope) => !scopes.includes(scope))) {
    throw new Error('Atlassian returned an incomplete Jira authorization grant.');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    scopes,
  };
}

export async function storePendingJiraAuthorization(pool, context, tokenBundle, keyring) {
  const { workspaceId, projectId, userSubject, sessionTokenHash } = context || {};
  if (![workspaceId, projectId, userSubject, sessionTokenHash].every((value) => typeof value === 'string' && value.trim())) {
    throw new TypeError('An authenticated owner session and project scope are required.');
  }
  const envelope = encryptJiraTokenBundle(tokenBundle, { workspaceId, projectId }, keyring);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO studio_jira_pending_authorizations
         (id, workspace_id, project_id, user_subject, session_token_hash, encrypted_credentials, credential_key_id, granted_scopes, expires_at)
       SELECT gen_random_uuid(), p.workspace_id, p.id, m.user_subject, $4, $5::jsonb, $6, $7::text[], now() + interval '10 minutes'
       FROM studio_client_projects p
       JOIN studio_workspace_members m ON m.workspace_id = p.workspace_id AND m.user_subject = $3 AND m.role = 'owner'
       WHERE p.workspace_id = $1 AND p.id = $2
       ON CONFLICT (workspace_id, project_id) DO UPDATE SET
         user_subject = EXCLUDED.user_subject,
         session_token_hash = EXCLUDED.session_token_hash,
         encrypted_credentials = EXCLUDED.encrypted_credentials,
         credential_key_id = EXCLUDED.credential_key_id,
         granted_scopes = EXCLUDED.granted_scopes,
         expires_at = EXCLUDED.expires_at,
         created_at = now()
       RETURNING project_id, expires_at`,
      [workspaceId, projectId, userSubject, sessionTokenHash, JSON.stringify(envelope), envelope.keyId, tokenBundle.scopes],
    );
    if (!result.rows[0]) throw new Error('The project is not available to this workspace owner.');
    await client.query(
      `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'jira.authorization_received', 'client_project', $3, '{"scope":"pending_site_project_selection"}'::jsonb)`,
      [workspaceId, userSubject, projectId],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function purgeExpiredJiraOAuthData(pool) {
  await pool.query('DELETE FROM studio_jira_oauth_transactions WHERE expires_at <= now()');
  await pool.query('DELETE FROM studio_jira_pending_authorizations WHERE expires_at <= now()');
}

const JIRA_ACCESSIBLE_RESOURCES_ENDPOINT = 'https://api.atlassian.com/oauth/token/accessible-resources';
const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';
const CLOUD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JIRA_PROJECT_ID_PATTERN = /^\d{1,20}$/;
const JIRA_PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;

async function requestAtlassianJson(url, accessToken) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('The Atlassian Jira API is unavailable.');
  }
  if (!response.ok) throw new Error('The Atlassian Jira API rejected this request.');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new Error('The Atlassian Jira API returned an invalid response.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The Atlassian Jira API returned an invalid response.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 524_288) {
        await reader.cancel();
        throw new Error('The Atlassian Jira API response exceeded the allowed size.');
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    throw new Error('The Atlassian Jira API returned an invalid response.');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('The Atlassian Jira API returned an invalid response.');
  }
}

async function pendingAuthorization(pool, context, keyring) {
  const { workspaceId, projectId, userSubject, sessionTokenHash } = context || {};
  if (![workspaceId, projectId, userSubject, sessionTokenHash].every((value) => typeof value === 'string' && value.trim())) {
    throw new TypeError('An authenticated owner session and project scope are required.');
  }
  const result = await pool.query(
    `SELECT encrypted_credentials, credential_key_id, granted_scopes, expires_at
     FROM studio_jira_pending_authorizations
     WHERE workspace_id = $1 AND project_id = $2 AND user_subject = $3 AND session_token_hash = $4 AND expires_at > now()`,
    [workspaceId, projectId, userSubject, sessionTokenHash],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The Jira authorization is missing or expired.');
  const tokenBundle = decryptJiraTokenBundle(row.encrypted_credentials, { workspaceId, projectId }, keyring);
  const storedScopes = Array.isArray(row.granted_scopes) ? [...row.granted_scopes].sort() : [];
  const credentialScopes = Array.isArray(tokenBundle.scopes) ? [...tokenBundle.scopes].sort() : [];
  if (JSON.stringify(storedScopes) !== JSON.stringify(credentialScopes)) throw new Error('The pending Jira authorization is invalid.');
  return { tokenBundle, grantedScopes: row.granted_scopes, expiresAt: row.expires_at, encryptedCredentials: row.encrypted_credentials, credentialKeyId: row.credential_key_id };
}

export function validateAccessibleJiraSite(site) {
  if (!isRecord(site) || typeof site.id !== 'string' || !CLOUD_ID_PATTERN.test(site.id) || typeof site.name !== 'string' || !site.name.trim() || site.name.length > 200 || typeof site.url !== 'string' || !Array.isArray(site.scopes)) return null;
  let parsed;
  try { parsed = new URL(site.url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || !(host.endsWith('.atlassian.net') || host.endsWith('.jira.com'))) return null;
  const scopes = [...new Set(site.scopes.filter((scope) => typeof scope === 'string' && scope.length <= 128))];
  if (!scopes.includes('read:jira-work') || !scopes.includes('write:jira-work')) return null;
  return { id: site.id, name: site.name.trim(), url: parsed.origin, scopes };
}

export function sanitizeJiraProjectSummary(project) {
  if (!isRecord(project) || !JIRA_PROJECT_ID_PATTERN.test(String(project.id || '')) || typeof project.key !== 'string' || !JIRA_PROJECT_KEY_PATTERN.test(project.key) || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 200) return null;
  return { id: String(project.id), key: project.key, name: project.name.trim() };
}

async function accessibleSitesForToken(tokenBundle) {
  const response = await requestAtlassianJson(JIRA_ACCESSIBLE_RESOURCES_ENDPOINT, tokenBundle.accessToken);
  if (!Array.isArray(response) || response.length > 200) throw new Error('The Atlassian Jira API returned an invalid site list.');
  return response.map(validateAccessibleJiraSite).filter(Boolean);
}

export async function listPendingJiraSites(pool, context, keyring) {
  const { tokenBundle } = await pendingAuthorization(pool, context, keyring);
  return accessibleSitesForToken(tokenBundle);
}

export async function searchPendingJiraProjects(pool, context, keyring, cloudId, query, startAt = 0, maxResults = 25) {
  if (typeof cloudId !== 'string' || !CLOUD_ID_PATTERN.test(cloudId) || typeof query !== 'string' || query.length > 200 || !Number.isInteger(startAt) || startAt < 0 || startAt > 10_000 || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
    throw new TypeError('A valid accessible Jira site and bounded project search are required.');
  }
  const { tokenBundle } = await pendingAuthorization(pool, context, keyring);
  const sites = await accessibleSitesForToken(tokenBundle);
  if (!sites.some((site) => site.id === cloudId)) throw new Error('The Jira site is not accessible to this pending authorization.');
  const url = new URL(`${JIRA_API_BASE}/${encodeURIComponent(cloudId)}/rest/api/3/project/search`);
  url.searchParams.set('startAt', String(startAt));
  url.searchParams.set('maxResults', String(maxResults));
  if (query.trim()) url.searchParams.set('query', query.trim());
  const response = await requestAtlassianJson(url, tokenBundle.accessToken);
  if (!isRecord(response) || !Array.isArray(response.values) || response.values.length > maxResults) throw new Error('The Atlassian Jira API returned an invalid project list.');
  const values = response.values.map(sanitizeJiraProjectSummary).filter(Boolean);
  if (!Number.isInteger(response.startAt) || response.startAt !== startAt || !Number.isInteger(response.maxResults) || response.maxResults < 1 || response.maxResults > maxResults || !Number.isInteger(response.total) || response.total < 0) throw new Error('The Atlassian Jira API returned invalid project pagination.');
  return { values, startAt: response.startAt, maxResults: response.maxResults, total: response.total, isLast: response.isLast === true };
}

export async function verifyAndPromotePendingJiraProject(pool, context, selection, keyring) {
  const { workspaceId, projectId, userSubject, sessionTokenHash } = context || {};
  const { cloudId, jiraProjectId } = selection || {};
  if (typeof cloudId !== 'string' || !CLOUD_ID_PATTERN.test(cloudId) || typeof jiraProjectId !== 'string' || !JIRA_PROJECT_ID_PATTERN.test(jiraProjectId)) {
    throw new TypeError('A valid Jira site and project selection are required.');
  }
  const snapshot = await pendingAuthorization(pool, context, keyring);
  const { tokenBundle } = snapshot;
  if (typeof tokenBundle.expiresAt === 'string' && Date.parse(tokenBundle.expiresAt) <= Date.now()) {
    throw new Error('The Jira authorization access token has expired.');
  }
  const sites = await accessibleSitesForToken(tokenBundle);
  const site = sites.find((item) => item.id === cloudId);
  if (!site) throw new Error('The Jira site is not accessible to this pending authorization.');
  const projectUrl = `${JIRA_API_BASE}/${encodeURIComponent(cloudId)}/rest/api/3/project/${encodeURIComponent(jiraProjectId)}`;
  const project = await requestAtlassianJson(projectUrl, tokenBundle.accessToken);
  const verifiedProject = sanitizeJiraProjectSummary(project);
  if (!verifiedProject || verifiedProject.id !== jiraProjectId) throw new Error('The selected Jira project could not be verified.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query(
      `SELECT id, encrypted_credentials, credential_key_id, granted_scopes
       FROM studio_jira_pending_authorizations
       WHERE workspace_id = $1 AND project_id = $2 AND user_subject = $3 AND session_token_hash = $4
         AND encrypted_credentials = $5::jsonb AND credential_key_id = $6 AND expires_at > now()
       FOR UPDATE`,
      [workspaceId, projectId, userSubject, sessionTokenHash, JSON.stringify(snapshot.encryptedCredentials), snapshot.credentialKeyId],
    );
    const row = pending.rows[0];
    if (!row) throw new Error('The Jira authorization is missing or expired.');
    decryptJiraTokenBundle(row.encrypted_credentials, { workspaceId, projectId }, keyring);
    const connection = await client.query(
      `INSERT INTO studio_jira_connections
         (id, workspace_id, project_id, connected_by, cloud_id, site_url, jira_project_id, jira_project_key, encrypted_credentials, credential_key_id, granted_scopes, access_token_expires_at, status)
       SELECT gen_random_uuid(), p.workspace_id, p.id, m.user_subject, $4, $5, $6, $7, $8::jsonb, $9, $10::text[], $11, 'connected'
       FROM studio_client_projects p
       JOIN studio_workspace_members m ON m.workspace_id = p.workspace_id AND m.user_subject = $3 AND m.role = 'owner'
       WHERE p.workspace_id = $1 AND p.id = $2
       ON CONFLICT (workspace_id, project_id) DO UPDATE SET
         connected_by = EXCLUDED.connected_by, cloud_id = EXCLUDED.cloud_id, site_url = EXCLUDED.site_url,
         jira_project_id = EXCLUDED.jira_project_id, jira_project_key = EXCLUDED.jira_project_key,
         encrypted_credentials = EXCLUDED.encrypted_credentials, credential_key_id = EXCLUDED.credential_key_id,
         granted_scopes = EXCLUDED.granted_scopes, access_token_expires_at = EXCLUDED.access_token_expires_at,
         status = 'connected', updated_at = now()
       RETURNING id, workspace_id, project_id, cloud_id, site_url, jira_project_id, jira_project_key,
                 granted_scopes, access_token_expires_at, status, created_at, updated_at`,
      [workspaceId, projectId, userSubject, cloudId, site.url, verifiedProject.id, verifiedProject.key, JSON.stringify(row.encrypted_credentials), row.credential_key_id, row.granted_scopes, tokenBundle.expiresAt],
    );
    if (!connection.rows[0]) throw new Error('The project is not available to this workspace owner.');
    await client.query('DELETE FROM studio_jira_pending_authorizations WHERE id = $1', [row.id]);
    await client.query(
      `INSERT INTO studio_audit_events (workspace_id, actor_subject, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'jira.project_connected', 'client_project', $3, $4::jsonb)`,
      [workspaceId, userSubject, projectId, JSON.stringify({ cloudId, jiraProjectId: verifiedProject.id, jiraProjectKey: verifiedProject.key })],
    );
    await client.query('COMMIT');
    return connection.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
