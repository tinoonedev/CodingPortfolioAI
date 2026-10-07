import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { readRuntimeConfig } from '../server/config.js';

const config = readRuntimeConfig();
const email = process.argv[2]?.trim().toLowerCase();
const role = process.argv[3] || 'owner';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!config.ready || !emailPattern.test(email || '') || email.length > 254 || !['owner', 'member'].includes(role)) {
  console.error('Invite creation blocked. Configure DATABASE_URL, STUDIO_WORKSPACE_ID, STUDIO_WORKSPACE_NAME, then run: npm run auth:invite -- <email> [owner|member]');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 3000,
  });
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const outputPath = resolve('.local-invites', `${createHash('sha256').update(email).digest('hex').slice(0, 12)}-${randomBytes(6).toString('hex')}.invite`);
  let tokenFileCreated = false;
  try {
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(outputPath), 0o700);
    await writeFile(outputPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    tokenFileCreated = true;
    await pool.query(
      `INSERT INTO studio_workspaces (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [config.workspaceId, config.workspaceName],
    );
    await pool.query(
      `INSERT INTO studio_account_invitations (token_hash, workspace_id, email, role, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours')`,
      [tokenHash, config.workspaceId, email, role],
    );
    console.log(`Invitation for ${email} (${role}) expires in 24 hours. Token saved to ${outputPath} with owner-only file permissions. Provide it through a trusted channel, then securely delete the file.`);
  } catch {
    if (tokenFileCreated) {
      const { unlink } = await import('node:fs/promises');
      await unlink(outputPath).catch(() => {});
    }
    console.error('Invite creation failed. Confirm database migration 2 has completed and the database is available.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
