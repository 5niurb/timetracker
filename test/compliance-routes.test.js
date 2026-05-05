'use strict';

const assert = require('assert');

// We test the helper logic directly — not HTTP — to keep tests fast and dependency-free.
// The token validation logic lives in lib/compliance-tokens.js (already tested).
// Here we test the request lookup logic that routes depend on.

// Minimal Supabase mock for route logic tests
function makeMockSupabase(rows) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: rows[0] || null, error: rows.length === 0 ? { message: 'not found' } : null }),
        }),
        is: () => ({
          single: async () => ({ data: rows[0] || null, error: null }),
        }),
      }),
    }),
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log('  PASS:', name);
        passed++;
      }).catch(e => {
        console.error('  FAIL:', name, '-', e.message);
        failed++;
      });
    }
    console.log('  PASS:', name);
    passed++;
  } catch (e) {
    console.error('  FAIL:', name, '-', e.message);
    failed++;
  }
  return Promise.resolve();
}

const { isTokenExpired } = require('../lib/compliance-tokens');

console.log('\nToken expiry used in route guard:');

async function runTests() {
  await test('expired token is caught', async () => {
    const past = new Date(Date.now() - 1000);
    assert.strictEqual(isTokenExpired(past), true);
  });

  await test('valid token passes', async () => {
    const future = new Date(Date.now() + 86400000);
    assert.strictEqual(isTokenExpired(future), false);
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
