import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString || (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'true')) {
  console.error('Database migration blocked: MIGRATION_DATABASE_URL (or DATABASE_URL) and production TLS configuration are required.');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 3000,
  });

  try {
    const baselineSchema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    const passwordAccountsMigration = await readFile(new URL('./migrations/002_password_accounts.sql', import.meta.url), 'utf8');
    const sharedRateLimitsMigration = await readFile(new URL('./migrations/003_shared_auth_rate_limits.sql', import.meta.url), 'utf8');
    const projectRequirementRevisionsMigration = await readFile(new URL('./migrations/004_project_requirement_revisions.sql', import.meta.url), 'utf8');
    const jiraConnectionsMigration = await readFile(new URL('./migrations/005_jira_connections.sql', import.meta.url), 'utf8');
    const jiraOAuthTransactionsMigration = await readFile(new URL('./migrations/006_jira_oauth_transactions.sql', import.meta.url), 'utf8');
    const jiraOAuthTransactionLimitMigration = await readFile(new URL('./migrations/007_jira_oauth_transaction_session_limit.sql', import.meta.url), 'utf8');
    const openAiProjectRunsMigration = await readFile(new URL('./migrations/008_openai_project_runs.sql', import.meta.url), 'utf8');
    const openAiConfigMemberLifecycleMigration = await readFile(new URL('./migrations/009_openai_config_member_lifecycle.sql', import.meta.url), 'utf8');
    const idempotentClientProjectCreationMigration = await readFile(new URL('./migrations/013_idempotent_client_project_creation.sql', import.meta.url), 'utf8');
    await pool.query(`CREATE TABLE IF NOT EXISTS fieldwork_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = await pool.query('SELECT version FROM fieldwork_schema_migrations ORDER BY version');
    const versions = new Set(applied.rows.map((row) => row.version));
    if (!versions.has(1)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(baselineSchema);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [1]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 1 applied.');
    }
    if (!versions.has(2)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(passwordAccountsMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [2]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 2 applied.');
    }
    if (!versions.has(3)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sharedRateLimitsMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [3]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 3 applied.');
    }
    if (!versions.has(4)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(projectRequirementRevisionsMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [4]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 4 applied.');
    }
    if (!versions.has(5)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(jiraConnectionsMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [5]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 5 applied.');
    }
    if (!versions.has(6)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(jiraOAuthTransactionsMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [6]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 6 applied.');
    }
    if (!versions.has(7)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(jiraOAuthTransactionLimitMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [7]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 7 applied.');
    }
    if (!versions.has(8)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(openAiProjectRunsMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [8]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 8 applied.');
    }
    if (!versions.has(9)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(openAiConfigMemberLifecycleMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [9]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 9 applied.');
    }
    if (!versions.has(13)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(idempotentClientProjectCreationMigration);
        await client.query('INSERT INTO fieldwork_schema_migrations (version) VALUES ($1)', [13]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log('Workspace database migration 13 applied.');
    }
    const current = await pool.query('SELECT version FROM fieldwork_schema_migrations ORDER BY version');
    if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 13].every((version) => new Set(current.rows.map((row) => row.version)).has(version))) {
      console.log('Workspace database schema is current.');
    }
  } catch {
    console.error('Database migration failed. Check the database connection and migration permissions.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
