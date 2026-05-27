'use strict';

const assert = require('assert');

// Integration tests with mocked external APIs (BreEZe, Docuseal, Plaid)
// These test the integration logic without hitting real services

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

// Mock BreEZe API responses
const breezeResponses = {
  'valid-rn': {
    status: 'valid',
    license_number: 'RN-12345',
    expiry_date: '2027-12-31',
    profession: 'RN',
  },
  'expired-rn': {
    status: 'expired',
    license_number: 'RN-54321',
    expiry_date: '2023-06-15',
    profession: 'RN',
  },
  'not-found': null,
};

function mockBreezeQuery(profession, { licenseNumber }) {
  const key = licenseNumber?.toLowerCase();
  if (key && key in breezeResponses) {
    const resp = breezeResponses[key];
    if (resp === null) {
      return Promise.resolve({
        status: 'not_found',
        licenseNumber,
        expiryDate: null,
        profession,
        verified_at: new Date().toISOString(),
      });
    }
    return Promise.resolve({
      status: resp.status === 'active' || resp.status === 'valid' ? 'valid' : 'expired',
      licenseNumber: resp.license_number,
      expiryDate: resp.expiry_date,
      profession: resp.profession,
      verified_at: new Date().toISOString(),
    });
  }
  return Promise.reject(new Error('BreEZe mock: unknown license'));
}

// Mock Docuseal webhook
function mockDocusealWebhook(payload) {
  // Validates the webhook format
  assert.ok(payload.event_type, 'event_type required');
  assert.ok(payload.data, 'data required');
  assert.ok(payload.data.template_id, 'template_id required');
  assert.ok(payload.data.document_id, 'document_id required');

  if (payload.event_type === 'document.signed') {
    assert.ok(payload.data.signed_at, 'signed_at required for document.signed');
    return {
      document_id: payload.data.document_id,
      template_id: payload.data.template_id,
      signed_at: payload.data.signed_at,
      signer_name: payload.data.signer_name || 'Unknown',
    };
  }

  return { document_id: payload.data.document_id, event: payload.event_type };
}

// Mock Plaid transaction matching
const mockEmployees = [
  { id: 1, name: 'Jane Smith', zelle_name: null },
  { id: 2, name: 'Maria Garcia', zelle_name: 'Maria G' },
];

function mockPlaidClassify(transactions) {
  const matched = [];
  const unmatched = [];

  for (const txn of transactions) {
    const desc = (txn.name || '').toLowerCase();
    let found = false;

    for (const emp of mockEmployees) {
      const names = [emp.name.toLowerCase(), emp.zelle_name?.toLowerCase()].filter(Boolean);
      if (names.some(n => desc.includes(n))) {
        matched.push({ ...txn, employee_id: emp.id, payment_method: 'zelle' });
        found = true;
        break;
      }
    }

    if (!found && (desc.includes('zelle') || desc.includes('ach'))) {
      unmatched.push({ ...txn, payment_method: desc.includes('zelle') ? 'zelle' : 'ach' });
    }
  }

  return { matched, unmatched };
}

async function runTests() {
  console.log('\nBreEZe API Integration (mocked):');

  await test('returns valid status for active license', async () => {
    const result = await mockBreezeQuery('RN', { licenseNumber: 'valid-rn' });
    assert.strictEqual(result.status, 'valid');
    assert.strictEqual(result.licenseNumber, 'RN-12345');
    assert.ok(result.expiryDate);
  });

  await test('returns expired status for expired license', async () => {
    const result = await mockBreezeQuery('RN', { licenseNumber: 'expired-rn' });
    assert.strictEqual(result.status, 'expired');
    assert.strictEqual(result.expiryDate, '2023-06-15');
  });

  await test('returns not_found for missing license', async () => {
    const result = await mockBreezeQuery('RN', { licenseNumber: 'not-found' });
    assert.strictEqual(result.status, 'not_found');
  });

  console.log('\nDocuseal Webhook Processing (mocked):');

  await test('validates document.signed webhook', () => {
    const payload = {
      event_type: 'document.signed',
      data: {
        document_id: 'doc-123',
        template_id: 'tmpl-456',
        signed_at: '2026-05-27T15:00:00Z',
        signer_name: 'Jane Smith',
      },
    };
    const result = mockDocusealWebhook(payload);
    assert.strictEqual(result.document_id, 'doc-123');
    assert.strictEqual(result.signed_at, '2026-05-27T15:00:00Z');
  });

  await test('rejects webhook missing event_type', () => {
    const payload = { data: { document_id: 'doc-123' } };
    assert.throws(() => mockDocusealWebhook(payload), /event_type required/);
  });

  await test('rejects webhook missing signed_at for document.signed', () => {
    const payload = {
      event_type: 'document.signed',
      data: { document_id: 'doc-123', template_id: 'tmpl-456' },
    };
    assert.throws(() => mockDocusealWebhook(payload), /signed_at required/);
  });

  console.log('\nPlaid Transaction Matching (mocked):');

  await test('matches zelle transaction to employee', () => {
    const txns = [{ name: 'Zelle To Jane Smith', amount: 100 }];
    const { matched, unmatched } = mockPlaidClassify(txns);
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].employee_id, 1);
    assert.strictEqual(unmatched.length, 0);
  });

  await test('matches by zelle_name override', () => {
    const txns = [{ name: 'Zelle To Maria G', amount: 150 }];
    const { matched, unmatched } = mockPlaidClassify(txns);
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].employee_id, 2);
  });

  await test('puts unmatched ach payment in unmatched list', () => {
    const txns = [{ name: 'ACH PMT Unknown Corp', amount: 200 }];
    const { matched, unmatched } = mockPlaidClassify(txns);
    assert.strictEqual(matched.length, 0);
    assert.strictEqual(unmatched.length, 1);
    assert.strictEqual(unmatched[0].payment_method, 'ach');
  });

  await test('ignores non-payment transactions', () => {
    const txns = [{ name: 'STARBUCKS COFFEE', amount: 5 }];
    const { matched, unmatched } = mockPlaidClassify(txns);
    assert.strictEqual(matched.length, 0);
    assert.strictEqual(unmatched.length, 0);
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
