import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;
export const DUMMY_PASSWORD_HASH = 'scrypt$32768$8$1$RmllbGR3b3JrRHVtbXkxNg$fiwaQAklbXSy0N0CuPekFP7ME8DksPdIrgbKA8dWZ7CW--pD9Fscf1FYecxzOjz0GPscwIE4wOx7iGK5cP26mA';

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return { valid: false, error: 'Password must be between 12 and 128 characters.' };
  }
  return { valid: true };
}

export async function hashPassword(password) {
  const validation = validatePassword(password);
  if (!validation.valid) throw new TypeError(validation.error);

  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await scrypt(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;
  const [algorithm, costText, blockText, parallelText, saltText, keyText, extra] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || extra !== undefined) return false;

  const cost = Number(costText);
  const blockSize = Number(blockText);
  const parallelism = Number(parallelText);
  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelism !== PARALLELISM) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltText, 'base64url');
    expected = Buffer.from(keyText, 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;

  const actual = await scrypt(password, salt, KEY_BYTES, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: MAX_MEMORY,
  });
  return timingSafeEqual(expected, actual);
}
