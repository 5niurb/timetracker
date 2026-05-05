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
  const before = new Date();
  const t = generateToken();
  const after = new Date();
  const diffDays = (t.expires_at - before) / (1000 * 60 * 60 * 24);
  assert.ok(diffDays >= TOKEN_TTL_DAYS - 0.01 && diffDays <= TOKEN_TTL_DAYS + 0.01,
    `expected ~${TOKEN_TTL_DAYS} days, got ${diffDays.toFixed(3)}`);
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

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
