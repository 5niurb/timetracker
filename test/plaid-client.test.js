'use strict';

const assert = require('assert');

let m;
try {
  m = require('../server/plaid-client');
} catch (e) {
  console.error('FAIL: server/plaid-client.js not found —', e.message);
  process.exit(1);
}

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

async function main() {
  console.log('\nExports:');
  test('createLinkToken exported', () => assert.strictEqual(typeof m.createLinkToken, 'function'));
  test('exchangePublicToken exported', () => assert.strictEqual(typeof m.exchangePublicToken, 'function'));
  test('syncTransactions exported', () => assert.strictEqual(typeof m.syncTransactions, 'function'));
  test('isConfigured exported', () => assert.strictEqual(typeof m.isConfigured, 'function'));

  console.log('\nisConfigured():');
  test('returns false when PLAID_CLIENT_ID missing', () => {
    const saved = process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_CLIENT_ID;
    assert.strictEqual(m.isConfigured(), false);
    process.env.PLAID_CLIENT_ID = saved;
  });
  test('returns false when PLAID_SECRET missing', () => {
    const saved = process.env.PLAID_SECRET;
    delete process.env.PLAID_SECRET;
    assert.strictEqual(m.isConfigured(), false);
    process.env.PLAID_SECRET = saved;
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
