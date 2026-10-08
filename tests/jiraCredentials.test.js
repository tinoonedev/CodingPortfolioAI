import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptJiraTokenBundle,
  encryptJiraTokenBundle,
  readJiraOAuthConfig,
  reencryptJiraTokenBundle,
} from '../server/jiraCredentials.js';

const context = { workspaceId: 'workspace-a', projectId: 'project-a' };
const makeKeyring = (activeKeyId, entries) => ({ activeKeyId, keys: new Map(Object.entries(entries).map(([id, value]) => [id, Buffer.from(value, 'base64')])) });
const keyA = randomBytes(32).toString('base64');
const keyB = randomBytes(32).toString('base64');
const bundle = { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: '2026-10-08T12:00:00.000Z', scopes: ['read:jira-work'] };

 test('Jira OAuth setup status returns setting names without values', () => {
  const config = readJiraOAuthConfig({
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://fieldwork.example',
    JIRA_OAUTH_CLIENT_ID: 'private-client-id',
    JIRA_OAUTH_CLIENT_SECRET: 'private-client-secret',
    JIRA_OAUTH_REDIRECT_URI: 'https://fieldwork.example/api/integrations/jira/callback',
    JIRA_TOKEN_ENCRYPTION_KEYRING: JSON.stringify({ activeKeyId: 'key-1', keys: { 'key-1': keyA } }),
  });
  assert.equal(config.configured, true);
  assert.equal(JSON.stringify({ configured: config.configured, missing: config.missing, invalid: config.invalid }).includes('private-client'), false);
  const missing = readJiraOAuthConfig({ NODE_ENV: 'production' });
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['JIRA_OAUTH_CLIENT_ID', 'JIRA_OAUTH_CLIENT_SECRET', 'JIRA_OAUTH_REDIRECT_URI', 'JIRA_TOKEN_ENCRYPTION_KEYRING']);
});

test('Jira credential envelope encrypts and decrypts with workspace and project binding', () => {
  const keyring = makeKeyring('key-1', { 'key-1': keyA });
  const envelope = encryptJiraTokenBundle(bundle, context, keyring);
  assert.deepEqual(decryptJiraTokenBundle(envelope, context, keyring), bundle);
  assert.throws(() => decryptJiraTokenBundle(envelope, { ...context, workspaceId: 'workspace-b' }, keyring), /decryption failed/);
  assert.throws(() => decryptJiraTokenBundle(envelope, { ...context, projectId: 'project-b' }, keyring), /decryption failed/);
  assert.throws(() => decryptJiraTokenBundle({ ...envelope, tag: `${envelope.tag.slice(0, -4)}AAAA` }, context, keyring), /decryption failed/);
});

test('retained encryption keys decrypt and re-encrypt with the active key', () => {
  const oldKeyring = makeKeyring('old', { old: keyA });
  const envelope = encryptJiraTokenBundle(bundle, context, oldKeyring);
  const rotatedKeyring = makeKeyring('new', { old: keyA, new: keyB });
  const rotated = reencryptJiraTokenBundle(envelope, context, rotatedKeyring);
  assert.equal(rotated.keyId, 'new');
  assert.deepEqual(decryptJiraTokenBundle(rotated, context, rotatedKeyring), bundle);
  assert.throws(() => decryptJiraTokenBundle(envelope, context, makeKeyring('new', { new: keyB })), /decryption failed/);
});

test('rejects invalid redirect, malformed keyring, and unexpected token fields', () => {
  const config = readJiraOAuthConfig({
    NODE_ENV: 'production', APP_ORIGIN: 'https://fieldwork.example',
    JIRA_OAUTH_CLIENT_ID: 'id', JIRA_OAUTH_CLIENT_SECRET: 'secret',
    JIRA_OAUTH_REDIRECT_URI: 'https://attacker.example/api/integrations/jira/callback',
    JIRA_TOKEN_ENCRYPTION_KEYRING: '{broken',
  });
  assert.deepEqual(config.invalid.sort(), ['JIRA_OAUTH_REDIRECT_URI', 'JIRA_TOKEN_ENCRYPTION_KEYRING']);
  assert.throws(() => encryptJiraTokenBundle({ ...bundle, clientSecret: 'must-not-be-stored' }, context, makeKeyring('key-1', { 'key-1': keyA })), /unsupported field/);
  assert.throws(() => encryptJiraTokenBundle({ ...bundle, expiresAt: 123 }, context, makeKeyring('key-1', { 'key-1': keyA })), /expiry/);
});
