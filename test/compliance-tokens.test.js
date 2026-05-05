'use strict';

const assert = require('assert');
const { generateToken, isTokenExpired, TOKEN_TTL_DAYS } = require('../lib/compliance-tokens');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS:', name);
    passed++;
  } catch (e) {
    console.error('  FAIL:', name, '-', e.message);
    failed++;
  }
}

console.log('\nToken generation:');
test('generateToken returns object with token and expires_at', () => {
  const t = generateToken();
  assert.ok(t.token, 'token present');
  assert.ok(t.expires_at instanceof Date, 'expires_at is Date');
});

test('token is a non-empty string', () => {
  const t = generateToken();
  assert.strictEqual(typeof t.token, 'string');
  assert.ok(t.token.length > 10);
});

test('expires_at is TOKEN_TTL_DAYS days in the future', () => {
  const before = Date.now();
  const t = generateToken();
  const after = Date.now();
  const ttlMs = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expMs = t.expires_at.getTime();
  assert.ok(expMs >= before + ttlMs && expMs <= after + ttlMs,
    `expected expires_at in [before+${TOKEN_TTL_DAYS}d, after+${TOKEN_TTL_DAYS}d]`);
});

console.log('\nToken expiry check:');
test('isTokenExpired returns false for future date', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60);
  assert.strictEqual(isTokenExpired(future), false);
});

test('isTokenExpired returns true for past date', () => {
  const past = new Date(Date.now() - 1000);
  assert.strictEqual(isTokenExpired(past), true);
});

test('isTokenExpired returns true for null', () => {
  assert.strictEqual(isTokenExpired(null), true);
});

test('isTokenExpired returns true for invalid date string', () => {
  assert.strictEqual(isTokenExpired('not-a-date'), true);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
