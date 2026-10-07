import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DUMMY_PASSWORD_HASH, hashPassword, validatePassword, verifyPassword } from '../server/passwords.js';

test('password validation enforces bounded length', () => {
  assert.equal(validatePassword('short').valid, false);
  assert.equal(validatePassword('x'.repeat(129)).valid, false);
  assert.equal(validatePassword('correct horse battery staple').valid, true);
});

test('scrypt password hashes are salted and verify only the matching password', async () => {
  const password = 'correct horse battery staple';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrect password', first), false);
  assert.equal(await verifyPassword(password, 'plain-text-password'), false);
  await assert.rejects(hashPassword('short'), /12 and 128/);
});

test('dummy account hash performs the same password verification work', async () => {
  assert.equal(await verifyPassword('incorrect-password-for-test', DUMMY_PASSWORD_HASH), false);
});
