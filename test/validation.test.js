/**
 * Tests for onboarding field validation (red phase — written before implementation)
 * Run: node test/validation.test.js
 */

const assert = require('assert');

// This will fail until lib/onboarding-validation.js is created
let v;
try {
  v = require('../lib/onboarding-validation');
} catch (e) {
  console.error('FAIL: lib/onboarding-validation.js not found —', e.message);
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

// ---- SSN ----
console.log('\nSSN validation:');
test('accepts valid SSN 123-45-6789', () => assert.equal(v.validateSSN('123-45-6789'), true));
test('rejects SSN without dashes', () => assert.equal(v.validateSSN('123456789'), false));
test('rejects short SSN', () => assert.equal(v.validateSSN('123-45-678'), false));
test('rejects SSN with letters', () => assert.equal(v.validateSSN('abc-de-fghi'), false));
test('rejects empty SSN', () => assert.equal(v.validateSSN(''), false));

// ---- EIN ----
console.log('\nEIN validation:');
test('accepts valid EIN 12-3456789', () => assert.equal(v.validateEIN('12-3456789'), true));
test('rejects EIN without dash', () => assert.equal(v.validateEIN('123456789'), false));
test('rejects short EIN', () => assert.equal(v.validateEIN('12-345678'), false));
test('rejects empty EIN', () => assert.equal(v.validateEIN(''), false));

// ---- ZIP ----
console.log('\nZIP validation:');
test('accepts 5-digit zip', () => assert.equal(v.validateZip('90210'), true));
test('accepts 9-digit zip with dash', () => assert.equal(v.validateZip('90210-1234'), true));
test('accepts 9-digit zip no dash (formatted)', () => assert.equal(v.validateZip('902101234'), true));
test('rejects 4-digit zip', () => assert.equal(v.validateZip('9021'), false));
test('rejects letters in zip', () => assert.equal(v.validateZip('9021A'), false));

// ---- Phone ----
console.log('\nPhone validation:');
test('accepts E.164 +13105551234', () => assert.equal(v.validatePhone('+13105551234'), true));
test('accepts 10-digit bare 3105551234', () => assert.equal(v.validatePhone('3105551234'), true));
test('accepts formatted (310) 555-1234', () => assert.equal(v.validatePhone('(310) 555-1234'), true));
test('rejects 9-digit phone', () => assert.equal(v.validatePhone('310555123'), false));
test('rejects empty phone', () => assert.equal(v.validatePhone(''), false));

// ---- US State ----
console.log('\nState validation:');
test('accepts CA', () => assert.equal(v.validateState('CA'), true));
test('accepts NY', () => assert.equal(v.validateState('NY'), true));
test('rejects lowercase ca', () => assert.equal(v.validateState('ca'), false));
test('rejects 3-char ZZ', () => assert.equal(v.validateState('ZZ'), false));
test('rejects empty', () => assert.equal(v.validateState(''), false));

// ---- Bank Routing (ABA checksum) ----
console.log('\nBank routing ABA checksum:');
// Real valid ABA: 121000358 (Wells Fargo CA), 021000021 (JP Morgan Chase)
test('accepts valid routing 121000358', () => assert.equal(v.validateBankRouting('121000358'), true));
test('accepts valid routing 021000021', () => assert.equal(v.validateBankRouting('021000021'), true));
test('rejects 8-digit routing', () => assert.equal(v.validateBankRouting('12100035'), false));
test('rejects 10-digit routing', () => assert.equal(v.validateBankRouting('1210003580'), false));
test('rejects routing with letters', () => assert.equal(v.validateBankRouting('12100035A'), false));
test('rejects invalid checksum 111111111', () => assert.equal(v.validateBankRouting('111111111'), false));

// ---- Bank Account ----
console.log('\nBank account validation:');
test('accepts 4-digit account', () => assert.equal(v.validateBankAccount('1234'), true));
test('accepts 17-digit account', () => assert.equal(v.validateBankAccount('12345678901234567'), true));
test('rejects 3-digit account', () => assert.equal(v.validateBankAccount('123'), false));
test('rejects 18-digit account', () => assert.equal(v.validateBankAccount('123456789012345678'), false));
test('rejects non-numeric', () => assert.equal(v.validateBankAccount('1234abc'), false));

// ---- DOB (must be in past, ≥18) ----
console.log('\nDate of birth validation:');
const today = new Date();
const adult = new Date(today);
adult.setFullYear(today.getFullYear() - 20);
const minor = new Date(today);
minor.setFullYear(today.getFullYear() - 16);
const future = new Date(today);
future.setDate(today.getDate() + 1);

function fmt(d) {
  return d.toISOString().split('T')[0];
}

test('accepts adult DOB (20 years ago)', () => assert.equal(v.validateDOB(fmt(adult)), true));
test('rejects minor DOB (16 years ago)', () => assert.equal(v.validateDOB(fmt(minor)), false));
test('rejects future DOB', () => assert.equal(v.validateDOB(fmt(future)), false));
test('rejects empty DOB', () => assert.equal(v.validateDOB(''), false));

// ---- License Expiration (must be in future) ----
console.log('\nLicense expiration validation:');
const pastDate = new Date(today);
pastDate.setDate(today.getDate() - 1);
const futureDate = new Date(today);
futureDate.setFullYear(today.getFullYear() + 1);

test('accepts future date', () => assert.equal(v.validateFutureDate(fmt(futureDate)), true));
test('rejects past date', () => assert.equal(v.validateFutureDate(fmt(pastDate)), false));
test('rejects empty', () => assert.equal(v.validateFutureDate(''), false));

// ---- Last4 extraction ----
console.log('\nLast4 extraction:');
test('extracts last4 from SSN 123-45-6789 -> 6789', () => assert.equal(v.extractLast4SSN('123-45-6789'), '6789'));
test('extracts last4 from routing 121000358 -> 0358', () => assert.equal(v.extractLast4Routing('121000358'), '0358'));
test('extracts last4 from account 123456789 -> 6789', () => assert.equal(v.extractLast4Account('123456789'), '6789'));

// ---- Full form validation ----
console.log('\nFull form validateOnboarding:');
const validForm = {
  first_name: 'Jane',
  last_name: 'Doe',
  home_phone: '3105551234',
  date_of_birth: fmt(adult),
  address_street: '123 Main St',
  address_city: 'Los Angeles',
  address_state: 'CA',
  address_zip: '90210',
  tin_type: 'SSN',
  tin_raw: '123-45-6789',
  w9_tax_classification: 'individual',
  w9_signed_at: fmt(today),
  bank_name: 'Wells Fargo',
  bank_account_owner_name: 'Jane Doe',
  bank_account_type: 'checking',
  bank_routing_raw: '121000358',
  bank_account_raw: '12345678',
  payment_method: 'ach',
  time_commitment_bucket: '25_to_35',
  attestation_checked: true,
  attestation_signature: 'Jane Doe',
  attestation_date: fmt(today),
};

test('valid form passes', () => {
  const errors = v.validateOnboarding(validForm);
  assert.deepStrictEqual(errors, {});
});

test('missing first_name fails', () => {
  const form = { ...validForm, first_name: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.first_name, 'expected first_name error');
});

test('invalid SSN fails', () => {
  const form = { ...validForm, tin_raw: '123456789' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.tin_raw, 'expected tin_raw error');
});

test('invalid routing fails', () => {
  const form = { ...validForm, bank_routing_raw: '111111111' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.bank_routing_raw, 'expected bank_routing_raw error');
});

test('attestation not checked fails', () => {
  const form = { ...validForm, attestation_checked: false };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.attestation_checked, 'expected attestation error');
});

// ---- time_commitment_bucket ----
console.log('\ntime_commitment_bucket validation:');
const VALID_BUCKETS = ['under_15', '15_to_25', '25_to_35', 'over_35'];

// validateTimeBucket function tests
if (v.validateTimeBucket) {
  VALID_BUCKETS.forEach(b => {
    test(`accepts valid bucket "${b}"`, () => assert.equal(v.validateTimeBucket(b), true));
  });
  test('rejects bucket "40_hours"', () => assert.equal(v.validateTimeBucket('40_hours'), false));
  test('rejects bucket empty string', () => assert.equal(v.validateTimeBucket(''), false));
  test('rejects bucket null', () => assert.equal(v.validateTimeBucket(null), false));
} else {
  test('validateTimeBucket exported', () => { throw new Error('validateTimeBucket not exported'); });
}

// Full form: time_commitment_bucket required
console.log('\ntime_commitment_bucket in full form:');
const validFormBucket = {
  first_name: 'Jane',
  last_name: 'Doe',
  home_phone: '3105551234',
  date_of_birth: fmt(adult),
  address_street: '123 Main St',
  address_city: 'Los Angeles',
  address_state: 'CA',
  address_zip: '90210',
  tin_type: 'SSN',
  tin_raw: '123-45-6789',
  w9_tax_classification: 'individual',
  w9_signed_at: fmt(today),
  bank_name: 'Wells Fargo',
  bank_account_owner_name: 'Jane Doe',
  payment_method: 'zelle',
  zelle_contact: 'jane@example.com',
  time_commitment_bucket: '15_to_25',
  attestation_checked: true,
  attestation_signature: 'Jane Doe',
  attestation_date: fmt(today),
};

test('valid bucket "15_to_25" passes full form', () => {
  const errors = v.validateOnboarding(validFormBucket);
  assert.ok(!errors.time_commitment_bucket, `unexpected error: ${errors.time_commitment_bucket}`);
});
test('missing time_commitment_bucket fails', () => {
  const form = { ...validFormBucket, time_commitment_bucket: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.time_commitment_bucket, 'expected time_commitment_bucket error');
});
test('invalid bucket string fails', () => {
  const form = { ...validFormBucket, time_commitment_bucket: 'part_time' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.time_commitment_bucket, 'expected time_commitment_bucket error');
});

// ---- payment_method enum (zelle | ach) ----
console.log('\npayment_method enum validation:');
test('payment_method "zelle" passes', () => {
  const form = { ...validFormBucket, payment_method: 'zelle', zelle_contact: 'jane@example.com' };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.payment_method, `unexpected error: ${errors.payment_method}`);
});
test('payment_method "ach" passes', () => {
  const form = {
    ...validFormBucket,
    payment_method: 'ach',
    bank_routing_raw: '121000358',
    bank_account_raw: '12345678',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.payment_method, `unexpected error: ${errors.payment_method}`);
});
test('payment_method "direct_deposit" rejected', () => {
  const form = { ...validFormBucket, payment_method: 'direct_deposit' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.payment_method, 'expected payment_method error');
});
test('payment_method "check" rejected', () => {
  const form = { ...validFormBucket, payment_method: 'check' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.payment_method, 'expected payment_method error');
});

// ---- Conditional ACH validation ----
console.log('\nConditional ACH validation:');
test('ACH missing routing → error', () => {
  const form = {
    ...validFormBucket,
    payment_method: 'ach',
    bank_routing_raw: '',
    bank_account_raw: '12345678',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.bank_routing_raw, 'expected bank_routing_raw error for ACH');
});
test('ACH missing account → error', () => {
  const form = {
    ...validFormBucket,
    payment_method: 'ach',
    bank_routing_raw: '121000358',
    bank_account_raw: '',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.bank_account_raw, 'expected bank_account_raw error for ACH');
});
test('Zelle missing routing → OK (not required)', () => {
  const form = {
    ...validFormBucket,
    payment_method: 'zelle',
    zelle_contact: 'jane@example.com',
    bank_routing_raw: '',
    bank_account_raw: '',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.bank_routing_raw, 'bank_routing_raw should NOT be required for Zelle');
  assert.ok(!errors.bank_account_raw, 'bank_account_raw should NOT be required for Zelle');
});
test('Zelle missing account → OK (not required)', () => {
  const form = {
    ...validFormBucket,
    payment_method: 'zelle',
    zelle_contact: 'jane@example.com',
    bank_account_raw: '',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.bank_account_raw, 'bank_account_raw should not be required for Zelle');
});

// ---- zelle_contact required when zelle ----
console.log('\nzelle_contact validation:');
test('Zelle missing zelle_contact → error', () => {
  const form = { ...validFormBucket, payment_method: 'zelle', zelle_contact: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.zelle_contact, 'expected zelle_contact error');
});
test('Zelle with zelle_contact → no error', () => {
  const form = { ...validFormBucket, payment_method: 'zelle', zelle_contact: 'jane@example.com' };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.zelle_contact, `unexpected zelle_contact error: ${errors.zelle_contact}`);
});

// ---- Summary ----
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
