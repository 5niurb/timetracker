'use strict';

const assert = require('assert');

let m;
try {
  m = require('../server/plaid-sync');
} catch (e) {
  console.error('FAIL: server/plaid-sync.js not found —', e.message);
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
  const employees = [
    { id: 1, name: 'Jane Smith', zelle_name: null },
    { id: 2, name: 'Maria Garcia', zelle_name: 'Maria G' },
    { id: 3, name: 'Jodi Williams', zelle_name: 'Jodi ACH' },
  ];

  console.log('\nbuildMatchMap():');
  test('exported', () => assert.strictEqual(typeof m.buildMatchMap, 'function'));

  const map = m.buildMatchMap(employees);

  test('full name maps to employee id', () => {
    assert.strictEqual(map.get('jane smith'), 1);
  });
  test('zelle_name overrides full name when set', () => {
    assert.strictEqual(map.get('maria g'), 2);
    // full name should NOT be in map when zelle_name is set
    assert.strictEqual(map.get('maria garcia'), undefined);
  });
  test('zelle_name handles ACH alias', () => {
    assert.strictEqual(map.get('jodi ach'), 3);
  });
  test('keys are lowercase', () => {
    for (const key of map.keys()) {
      assert.strictEqual(key, key.toLowerCase(), `Key "${key}" is not lowercase`);
    }
  });
  test('empty zelle_name falls back to full name', () => {
    const empWithEmpty = [{ id: 99, name: 'Test Person', zelle_name: '' }];
    const m2 = m.buildMatchMap(empWithEmpty);
    assert.strictEqual(m2.get('test person'), 99);
  });

  console.log('\nmatchTransaction():');
  test('exported', () => assert.strictEqual(typeof m.matchTransaction, 'function'));

  test('matches by substring of transaction name', () => {
    const result = m.matchTransaction('Zelle payment to Jane Smith 1234', map);
    assert.strictEqual(result, 1);
  });
  test('matches by zelle_name substring', () => {
    const result = m.matchTransaction('Zelle To Maria G', map);
    assert.strictEqual(result, 2);
  });
  test('case-insensitive match', () => {
    const result = m.matchTransaction('ZELLE TO JANE SMITH', map);
    assert.strictEqual(result, 1);
  });
  test('returns null for no match', () => {
    const result = m.matchTransaction('Starbucks Coffee', map);
    assert.strictEqual(result, null);
  });
  test('returns null for empty description', () => {
    const result = m.matchTransaction('', map);
    assert.strictEqual(result, null);
  });
  test('returns null for null description', () => {
    const result = m.matchTransaction(null, map);
    assert.strictEqual(result, null);
  });

  console.log('\nclassifyTransactions():');
  test('exported', () => assert.strictEqual(typeof m.classifyTransactions, 'function'));

  const transactions = [
    { transaction_id: 'tx1', date: '2026-05-01', amount: 100, name: 'Zelle Jane Smith' },
    { transaction_id: 'tx2', date: '2026-05-02', amount: 200, name: 'Zelle Maria G' },
    { transaction_id: 'tx3', date: '2026-05-03', amount: 50, name: 'STARBUCKS' },
  ];

  const { matched, unmatched } = m.classifyTransactions(transactions, map);

  test('matched count correct', () => assert.strictEqual(matched.length, 2));
  test('unmatched count correct', () => assert.strictEqual(unmatched.length, 1));
  test('matched item has employee_id', () => assert.strictEqual(matched[0].employee_id, 1));
  test('matched item has plaid_transaction_id', () => assert.strictEqual(matched[0].plaid_transaction_id, 'tx1'));
  test('matched item has transaction_date', () => assert.strictEqual(matched[0].transaction_date, '2026-05-01'));
  test('matched item has amount', () => assert.strictEqual(matched[0].amount, 100));
  test('unmatched item has plaid_transaction_id', () => assert.strictEqual(unmatched[0].plaid_transaction_id, 'tx3'));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
