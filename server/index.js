import { Pool } from 'pg';
import { createWorkspaceApp } from './app.js';
import { readRuntimeConfig } from './config.js';
import { readJiraOAuthConfig } from './jiraCredentials.js';

const config = readRuntimeConfig();
const jiraOAuthConfig = readJiraOAuthConfig();
const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
    })
  : null;

const app = createWorkspaceApp({ config, pool, jiraOAuthConfig });
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
