import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceApp } from '../server/app.js';
import { readRuntimeConfig, validateClientProject } from '../server/config.js';

test('workspace configuration fails closed and reports missing setting names only', () => {
  const config = readRuntimeConfig({ NODE_ENV: 'test' });

  assert.equal(config.ready, false);
  assert.ok(config.missing.includes('DATABASE_URL'));
  assert.equal(JSON.stringify(config).includes('replace-me'), false);
});

test('production requires PostgreSQL TLS and a valid workspace identifier', () => {
  const config = readRuntimeConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:secret@db.example.test/fieldwork',
    DATABASE_SSL: 'false',
    APP_ORIGIN: 'https://studio.example.test',
    STUDIO_WORKSPACE_ID: 'invalid-id',
    STUDIO_WORKSPACE_NAME: 'Fieldwork',
  });

  assert.equal(config.ready, false);
  assert.ok(config.invalid.includes('DATABASE_SSL'));
  assert.ok(config.invalid.includes('STUDIO_WORKSPACE_ID'));
});

test('valid PostgreSQL and workspace settings enable local password accounts', () => {
  const config = readRuntimeConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://fieldwork:secret@db.example.test/fieldwork',
    DATABASE_SSL: 'true',
    APP_ORIGIN: 'https://studio.example.test',
    STUDIO_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
    STUDIO_WORKSPACE_NAME: 'Fieldwork Studio',
  });

  assert.equal(config.ready, true);
  assert.deepEqual(config.missing, []);
  assert.deepEqual(config.invalid, []);
  assert.equal(config.cookieName, '__Host-fieldwork_session');
});

test('production requires a secure same-origin browser origin', () => {
  const config = readRuntimeConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://fieldwork:secret@db.example.test/fieldwork',
    DATABASE_SSL: 'true',
    APP_ORIGIN: 'http://studio.example.test',
    STUDIO_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
    STUDIO_WORKSPACE_NAME: 'Fieldwork Studio',
  });

  assert.equal(config.ready, false);
  assert.ok(config.invalid.includes('APP_ORIGIN'));
});

test('client project validation trims values and enforces each field limit', () => {
  const valid = validateClientProject({
    name: '  Waypoint  ',
    client: ' Waypoint Inc. ',
    problem: ' Plans are hard to track. ',
    targetUser: 'Travel planners',
    successSignal: 'More completed itineraries',
    approved: true,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.project.name, 'Waypoint');

  const invalid = validateClientProject({
    name: 'W'.repeat(71),
    client: 'Client',
    problem: 'Problem',
    targetUser: 'User',
    successSignal: 'Signal',
    approved: true,
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /70 characters/);
  assert.equal(validateClientProject([]).valid, false);
  assert.match(validateClientProject({ name: 'x' }).error, /explicitly approved/);
});

test('real HTTP API fails closed when workspace integrations are unconfigured', async (context) => {
  const config = readRuntimeConfig({ NODE_ENV: 'test' });
  const server = createWorkspaceApp({ config, pool: null }).listen(0, '127.0.0.1');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/session`);
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, 'SETUP_REQUIRED');
  assert.ok(payload.error.missing.includes('DATABASE_URL'));
});
