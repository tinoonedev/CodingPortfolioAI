import { Pool } from 'pg';
import { createWorkspaceApp } from './app.js';
import { readRuntimeConfig } from './config.js';
import { purgeExpiredJiraOAuthData, readJiraOAuthConfig } from './jiraCredentials.js';
import { readOpenAiRuntimeConfig } from './openaiCredentials.js';

const config = readRuntimeConfig();
const jiraOAuthConfig = readJiraOAuthConfig();
const openAiConfig = readOpenAiRuntimeConfig();
const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
    })
  : null;

const app = createWorkspaceApp({ config, pool, jiraOAuthConfig, openAiConfig });
if (pool) {
  const jiraOAuthCleanup = setInterval(() => {
    purgeExpiredJiraOAuthData(pool).catch(() => {});
  }, 60_000);
  jiraOAuthCleanup.unref();
}
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(config.port, host, () => {
  console.log(`Fieldwork API listening on ${host}:${config.port}${config.ready ? '' : ' (workspace setup required)'}`);
});

async function shutdown() {
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
