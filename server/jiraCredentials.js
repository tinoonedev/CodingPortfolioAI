import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CALLBACK_PATH = '/api/integrations/jira/callback';
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
