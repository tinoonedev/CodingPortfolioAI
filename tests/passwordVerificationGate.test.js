import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordVerificationGate } from '../server/passwordVerificationGate.js';

test('password verification gate refuses work above its configured concurrent limit', () => {
  const gate = createPasswordVerificationGate(4);
  const active = Array.from({ length: 4 }, () => gate.tryAcquire());

  assert.equal(active.every((release) => typeof release === 'function'), true);
  assert.equal(gate.tryAcquire(), null);

  active[0]();
  assert.equal(typeof gate.tryAcquire(), 'function');
});

test('password verification release is idempotent and restores capacity', () => {
  const gate = createPasswordVerificationGate(1);
  const release = gate.tryAcquire();
  assert.equal(gate.tryAcquire(), null);

  release();
  release();
  assert.equal(typeof gate.tryAcquire(), 'function');
});

test('password verification gate requires a positive integer limit', () => {
  for (const limit of [0, -1, 1.5, '2']) {
    assert.throws(() => createPasswordVerificationGate(limit), TypeError);
  }
});
