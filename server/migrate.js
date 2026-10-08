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
    if (versions.has(1) && versions.has(2) && versions.has(3) && versions.has(4) && versions.has(5)) {
      console.log('Workspace database schema is current.');
    }
  } catch {
    console.error('Database migration failed. Check the database connection and migration permissions.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
