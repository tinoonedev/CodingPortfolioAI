import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ENVELOPE_FIELDS = new Set(['version', 'keyId', 'iv', 'ciphertext', 'tag']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readOpenAiRuntimeConfig(env = process.env) {
  const missing = [];
  const invalid = [];
  if (!env.OPENAI_TOKEN_ENCRYPTION_KEYRING?.trim()) missing.push('OPENAI_TOKEN_ENCRYPTION_KEYRING');
  if (!env.OPENAI_MODEL_PRICING_USD_PER_MILLION?.trim()) missing.push('OPENAI_MODEL_PRICING_USD_PER_MILLION');
  let keyring = null;
  let pricing = Object.create(null);

  if (env.OPENAI_TOKEN_ENCRYPTION_KEYRING?.trim()) {
    try {
      const parsed = JSON.parse(env.OPENAI_TOKEN_ENCRYPTION_KEYRING);
      if (!isRecord(parsed) || !isRecord(parsed.keys) || !KEY_ID_PATTERN.test(parsed.activeKeyId || '') || Object.keys(parsed.keys).length < 1 || Object.keys(parsed.keys).length > 8) throw new Error('invalid');
      const keys = new Map();
      for (const [keyId, encoded] of Object.entries(parsed.keys)) {
        if (!KEY_ID_PATTERN.test(keyId) || typeof encoded !== 'string') throw new Error('invalid');
        const key = Buffer.from(encoded, 'base64');
        if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('invalid');
        keys.set(keyId, key);
      }
      if (!keys.has(parsed.activeKeyId)) throw new Error('invalid');
      keyring = { activeKeyId: parsed.activeKeyId, keys };
    } catch {
      invalid.push('OPENAI_TOKEN_ENCRYPTION_KEYRING');
    }
  }

  if (env.OPENAI_MODEL_PRICING_USD_PER_MILLION?.trim()) {
    try {
      const parsed = JSON.parse(env.OPENAI_MODEL_PRICING_USD_PER_MILLION);
      if (!isRecord(parsed) || Object.keys(parsed).length === 0 || Object.keys(parsed).length > 64) throw new Error('invalid');
      const trustedPricing = Object.create(null);
      for (const [model, rates] of Object.entries(parsed)) {
        if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model) || !isRecord(rates) || !Number.isFinite(rates.input) || rates.input <= 0 || !Number.isFinite(rates.output) || rates.output <= 0) throw new Error('invalid');
        trustedPricing[model] = { input: rates.input, output: rates.output };
      }
      pricing = trustedPricing;
    } catch {
      invalid.push('OPENAI_MODEL_PRICING_USD_PER_MILLION');
    }
  }

  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    keyring,
    pricing,
    allowedModels: Object.keys(pricing),
  };
}

function associatedData({ workspaceId, projectId }) {
  if (typeof workspaceId !== 'string' || typeof projectId !== 'string' || !workspaceId || !projectId) {
    throw new TypeError('Workspace and project identifiers are required for credential encryption.');
  }
  return Buffer.from(`fieldwork:openai:workspace:${workspaceId}:project:${projectId}:v1`, 'utf8');
}

export function validateOpenAiApiKey(value) {
  return typeof value === 'string' && /^sk-[A-Za-z0-9_-]{20,500}$/.test(value.trim())
    ? { valid: true, value: value.trim() }
    : { valid: false, error: 'Enter a valid OpenAI project API key.' };
}

export function isOpenAiModelAllowed(pricing, model) {
  return isRecord(pricing) && typeof model === 'string' && Object.hasOwn(pricing, model) && isRecord(pricing[model]);
}

export function encryptOpenAiApiKey(apiKey, context, keyring) {
  const validated = validateOpenAiApiKey(apiKey);
  if (!validated.valid) throw new TypeError(validated.error);
  const keyId = keyring?.activeKeyId;
  const key = keyring?.keys?.get(keyId);
  if (!KEY_ID_PATTERN.test(keyId || '') || !Buffer.isBuffer(key) || key.length !== 32) throw new Error('OpenAI credential encryption is not configured.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(validated.value, 'utf8'), cipher.final()]);
  return { version: 1, keyId, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptOpenAiApiKey(envelope, context, keyring) {
  try {
    if (!isRecord(envelope) || Object.keys(envelope).length !== ENVELOPE_FIELDS.size || Object.keys(envelope).some((field) => !ENVELOPE_FIELDS.has(field)) || envelope.version !== 1 || !KEY_ID_PATTERN.test(envelope.keyId || '')) throw new Error('invalid');
    const key = keyring?.keys?.get(envelope.keyId);
    const iv = Buffer.from(envelope.iv, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (!Buffer.isBuffer(key) || key.length !== 32 || iv.length !== 12 || !ciphertext.length || tag.length !== 16 || iv.toString('base64') !== envelope.iv || ciphertext.toString('base64') !== envelope.ciphertext || tag.toString('base64') !== envelope.tag) throw new Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    if (!validateOpenAiApiKey(plaintext).valid) throw new Error('invalid');
    return plaintext;
  } catch {
    throw new Error('OpenAI credential decryption failed.');
  }
}

export function isOpenAiCredentialUsable(envelope, context, keyring) {
  try {
    decryptOpenAiApiKey(envelope, context, keyring);
    return true;
  } catch {
    return false;
  }
}

export function estimateMaximumCostUsd({ inputTokenUpperBound, maxOutputTokens, inputUsdPerMillion, outputUsdPerMillion }) {
  if (![inputTokenUpperBound, maxOutputTokens, inputUsdPerMillion, outputUsdPerMillion].every(Number.isFinite) || !Number.isInteger(inputTokenUpperBound) || inputTokenUpperBound < 1 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || inputUsdPerMillion <= 0 || outputUsdPerMillion <= 0) {
    throw new TypeError('A trusted input-token upper bound, output limit, and model pricing are required.');
  }
  return (inputTokenUpperBound * inputUsdPerMillion + maxOutputTokens * outputUsdPerMillion) / 1_000_000;
}

export function calculateActualCostUsd({ inputTokens, outputTokens, inputUsdPerMillion, outputUsdPerMillion }) {
  if (![inputTokens, outputTokens, inputUsdPerMillion, outputUsdPerMillion].every(Number.isFinite) || inputTokens < 0 || outputTokens < 0 || inputUsdPerMillion <= 0 || outputUsdPerMillion <= 0) {
    throw new TypeError('Valid token usage and trusted model pricing are required.');
  }
  return (inputTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000;
}
