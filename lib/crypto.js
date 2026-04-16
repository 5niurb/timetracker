'use strict';

/**
 * AES-256-GCM encryption helpers for onboarding sensitive fields.
 *
 * Ciphertext encoding: base64( IV(12 bytes) || authTag(16 bytes) || ciphertext )
 * Key source: process.env.PAYTRACK_ENCRYPTION_KEY — base64-encoded 32 bytes.
 *
 * Usage:
 *   const { encryptValue, decryptValue } = require('./lib/crypto');
 *   const ct = await encryptValue('123-45-6789');   // base64 string
 *   const pt = await decryptValue(ct);              // '123-45-6789'
 */

const { randomBytes, createCipheriv, createDecipheriv } = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
// Minimum base64 length for IV(12) + authTag(16) + at least 0 bytes of ciphertext
// base64( 28 bytes ) = ceil(28/3)*4 = 40 chars
const MIN_ENCRYPTED_BASE64_LEN = 40;

/**
 * Load and validate the encryption key from PAYTRACK_ENCRYPTION_KEY env var.
 * Throws a clear error if the key is missing or the wrong length.
 * @returns {Buffer} 32-byte key
 */
function loadKey() {
  const raw = process.env.PAYTRACK_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'PAYTRACK_ENCRYPTION_KEY is not set. ' +
        'Run: node scripts/generate-encryption-key.mjs and set the result in Render env vars.',
    );
  }
  let key;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('PAYTRACK_ENCRYPTION_KEY is not valid base64.');
  }
  if (key.length !== 32) {
    throw new Error(
      `PAYTRACK_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        'Regenerate with: node scripts/generate-encryption-key.mjs',
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns null if value is null or undefined (passthrough for optional fields).
 * @param {string|null|undefined} plaintext
 * @returns {string|null} base64-encoded IV + authTag + ciphertext, or null
 */
async function encryptValue(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: IV(12) || authTag(16) || ciphertext(N)
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext produced by encryptValue.
 * Returns null if ciphertext is null or undefined.
 * Throws on authentication failure (tampered data) or wrong key.
 * @param {string|null|undefined} ciphertext
 * @returns {string|null} plaintext, or null
 */
async function decryptValue(ciphertext) {
  if (ciphertext === null || ciphertext === undefined) return null;

  const key = loadKey();
  const combined = Buffer.from(String(ciphertext), 'base64');

  if (combined.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Ciphertext is too short to be a valid encrypted value.');
  }

  const iv = combined.subarray(0, IV_BYTES);
  const authTag = combined.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const encrypted = combined.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Heuristic: returns true if the value looks like an AES-256-GCM ciphertext
 * produced by encryptValue (base64, >= minimum length).
 * Used to detect already-encrypted values in migration scenarios.
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.length < MIN_ENCRYPTED_BASE64_LEN) return false;
  // Must be valid base64 and decode to at least IV + authTag bytes
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.length >= IV_BYTES + AUTH_TAG_BYTES;
  } catch {
    return false;
  }
}

/**
 * Generate a new random 32-byte key encoded as base64.
 * Run once to generate the key; store in PAYTRACK_ENCRYPTION_KEY env var.
 * @returns {string} base64-encoded 32-byte key
 */
function generateKey() {
  return randomBytes(32).toString('base64');
}

module.exports = { encryptValue, decryptValue, isEncrypted, generateKey };
