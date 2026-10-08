import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  calculateActualCostUsd,
  decryptOpenAiApiKey,
  encryptOpenAiApiKey,
  estimateMaximumCostUsd,
  isOpenAiCredentialUsable,
  isOpenAiModelAllowed,
  readOpenAiRuntimeConfig,
  validateOpenAiApiKey,
} from '../server/openaiCredentials.js';

const context = { workspaceId: 'workspace-a', projectId: 'project-a' };
const keyring = { activeKeyId: 'test-v1', keys: new Map([['test-v1', randomBytes(32)]]) };

test('OpenAI credentials are encrypted and cryptographically bound to the workspace and project', () => {
  const apiKey = `sk-proj-${randomBytes(32).toString('hex')}`;
  const envelope = encryptOpenAiApiKey(apiKey, context, keyring);
  assert.equal(JSON.stringify(envelope).includes(apiKey), false);
  assert.equal(decryptOpenAiApiKey(envelope, context, keyring), apiKey);
  assert.equal(isOpenAiCredentialUsable(envelope, context, keyring), true);
  assert.equal(isOpenAiCredentialUsable(envelope, { ...context, projectId: 'project-b' }, keyring), false);
  assert.equal(isOpenAiCredentialUsable(envelope, context, null), false);
  assert.throws(() => decryptOpenAiApiKey(envelope, { ...context, projectId: 'project-b' }, keyring), /decryption failed/);
  assert.throws(() => decryptOpenAiApiKey(envelope, { ...context, workspaceId: 'workspace-b' }, keyring), /decryption failed/);
});

test('OpenAI key validation rejects malformed values without echoing submitted data', () => {
  const secret = 'definitely-not-an-api-key';
  const result = validateOpenAiApiKey(secret);
  assert.equal(result.valid, false);
  assert.equal(result.error.includes(secret), false);
});

test('OpenAI runtime configuration accepts only valid keyrings and explicit positive token rates', () => {
  const validKeyring = JSON.stringify({ activeKeyId: 'k1', keys: { k1: randomBytes(32).toString('base64') } });
  const validPricing = JSON.stringify({ 'gpt-6-luna': { input: 0.2, output: 1 } });
  const configured = readOpenAiRuntimeConfig({ OPENAI_TOKEN_ENCRYPTION_KEYRING: validKeyring, OPENAI_MODEL_PRICING_USD_PER_MILLION: validPricing });
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.allowedModels, ['gpt-6-luna']);
  assert.equal(configured.pricing.constructor, undefined);
  assert.equal(Object.hasOwn(configured.pricing, 'toString'), false);
  assert.equal(isOpenAiModelAllowed(configured.pricing, 'gpt-6-luna'), true);
  assert.equal(isOpenAiModelAllowed(configured.pricing, 'constructor'), false);
  assert.equal(isOpenAiModelAllowed(Object.create({ constructor: { input: 1, output: 1 } }), 'constructor'), false);
  const invalid = readOpenAiRuntimeConfig({ OPENAI_TOKEN_ENCRYPTION_KEYRING: '{bad', OPENAI_MODEL_PRICING_USD_PER_MILLION: '{bad' });
  assert.equal(invalid.configured, false);
  assert.deepEqual(invalid.invalid.sort(), ['OPENAI_MODEL_PRICING_USD_PER_MILLION', 'OPENAI_TOKEN_ENCRYPTION_KEYRING'].sort());
});

test('OpenAI budget estimation requires a trusted input-token upper bound and configured rates', () => {
  const reserved = estimateMaximumCostUsd({ inputTokenUpperBound: 10, maxOutputTokens: 1000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1 });
  const settled = calculateActualCostUsd({ inputTokens: 1, outputTokens: 1000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1 });
  assert.ok(reserved > settled);
  assert.ok(settled > 0);
  assert.throws(() => estimateMaximumCostUsd({ inputBytes: 100, maxOutputTokens: 1, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1 }), /trusted input-token upper bound/);
  assert.throws(() => estimateMaximumCostUsd({ inputTokenUpperBound: 1, maxOutputTokens: 1, inputUsdPerMillion: 0, outputUsdPerMillion: 1 }));
});
