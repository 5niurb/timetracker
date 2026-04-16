/**
 * Tests for onboarding field validation
 * Run: node test/validation.test.js
 */

'use strict';

const assert = require('assert');

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

function fmt(d) {
  return d.toISOString().split('T')[0];
}

// ---- Date helpers ----
const today = new Date();
const adult = new Date(today);
adult.setFullYear(today.getFullYear() - 20);
const minor = new Date(today);
minor.setFullYear(today.getFullYear() - 16);
const futureDate = new Date(today);
futureDate.setFullYear(today.getFullYear() + 1);
const pastDate = new Date(today);
pastDate.setDate(today.getDate() - 1);
const futureDOB = new Date(today);
futureDOB.setDate(today.getDate() + 1);

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
test('accepts 9-digit zip no dash', () => assert.equal(v.validateZip('902101234'), true));
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
test('rejects invalid ZZ', () => assert.equal(v.validateState('ZZ'), false));
test('rejects empty', () => assert.equal(v.validateState(''), false));

// ---- Bank Routing (ABA checksum) ----
console.log('\nBank routing ABA checksum:');
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
test('accepts adult DOB (20 years ago)', () => assert.equal(v.validateDOB(fmt(adult)), true));
test('rejects minor DOB (16 years ago)', () => assert.equal(v.validateDOB(fmt(minor)), false));
test('rejects future DOB', () => assert.equal(v.validateDOB(fmt(futureDOB)), false));
test('rejects empty DOB', () => assert.equal(v.validateDOB(''), false));

// ---- Future date (license/insurance expiration) ----
console.log('\nFuture date validation:');
test('accepts future date', () => assert.equal(v.validateFutureDate(fmt(futureDate)), true));
test('rejects past date', () => assert.equal(v.validateFutureDate(fmt(pastDate)), false));
test('rejects empty', () => assert.equal(v.validateFutureDate(''), false));

// ---- URL validation ----
console.log('\nURL validation:');
test('accepts http URL', () => assert.equal(v.validateURL('http://example.com/license'), true));
test('accepts https URL', () => assert.equal(v.validateURL('https://license.ca.gov/verify/ABC123'), true));
test('rejects ftp URL', () => assert.equal(v.validateURL('ftp://example.com'), false));
test('rejects bare string', () => assert.equal(v.validateURL('not a url'), false));
test('rejects empty string', () => assert.equal(v.validateURL(''), false));
test('rejects null', () => assert.equal(v.validateURL(null), false));

// ---- Professional license entry validation ----
console.log('\nProfessional license entry validation:');
const validLic = {
  type: 'RN',
  number: 'RN1234567',
  status: 'Active',
  expiration: fmt(futureDate),
  license_url: 'https://rn.ca.gov/verify/RN1234567',
};

test('accepts valid RN license entry', () => {
  const errors = v.validateProfLicense(validLic);
  assert.deepStrictEqual(errors, {});
});

test('accepts Esthetician license entry', () => {
  const errors = v.validateProfLicense({ ...validLic, type: 'Esthetician' });
  assert.deepStrictEqual(errors, {});
});

test('accepts NP license entry', () => {
  const errors = v.validateProfLicense({ ...validLic, type: 'NP' });
  assert.deepStrictEqual(errors, {});
});

test('accepts Other type with type_other filled', () => {
  const errors = v.validateProfLicense({ ...validLic, type: 'Other', type_other: 'CNA' });
  assert.deepStrictEqual(errors, {});
});

test('rejects Other type without type_other', () => {
  const errors = v.validateProfLicense({ ...validLic, type: 'Other' });
  assert.ok(errors.type_other, 'expected type_other error');
});

test('rejects invalid type', () => {
  const errors = v.validateProfLicense({ ...validLic, type: 'MD' });
  assert.ok(errors.type, 'expected type error');
});

test('rejects missing number', () => {
  const errors = v.validateProfLicense({ ...validLic, number: '' });
  assert.ok(errors.number, 'expected number error');
});

test('rejects invalid status', () => {
  const errors = v.validateProfLicense({ ...validLic, status: 'Expired' });
  assert.ok(errors.status, 'expected status error');
});

test('rejects Suspended status (valid enum)', () => {
  // Suspended IS a valid status — should pass
  const errors = v.validateProfLicense({ ...validLic, status: 'Suspended' });
  assert.ok(!errors.status, 'Suspended should be valid');
});

test('rejects past expiration', () => {
  const errors = v.validateProfLicense({ ...validLic, expiration: fmt(pastDate) });
  assert.ok(errors.expiration, 'expected expiration error');
});

test('rejects invalid license_url', () => {
  const errors = v.validateProfLicense({ ...validLic, license_url: 'not-a-url' });
  assert.ok(errors.license_url, 'expected license_url error');
});

test('rejects null entry', () => {
  const errors = v.validateProfLicense(null);
  assert.ok(errors._entry, 'expected _entry error for null');
});

// ---- File upload validation ----
console.log('\nFile upload validation:');
test('accepts valid PDF under 10MB', () => {
  const err = v.validateUploadFile({ mimetype: 'application/pdf', size: 5 * 1024 * 1024 });
  assert.strictEqual(err, null);
});
test('accepts valid JPEG under 10MB', () => {
  const err = v.validateUploadFile({ mimetype: 'image/jpeg', size: 2 * 1024 * 1024 });
  assert.strictEqual(err, null);
});
test('accepts valid PNG under 10MB', () => {
  const err = v.validateUploadFile({ mimetype: 'image/png', size: 1024 });
  assert.strictEqual(err, null);
});
test('rejects file over 10MB', () => {
  const err = v.validateUploadFile({ mimetype: 'application/pdf', size: 11 * 1024 * 1024 });
  assert.ok(err, 'expected error for oversized file');
});
test('rejects unsupported mimetype', () => {
  const err = v.validateUploadFile({ mimetype: 'application/msword', size: 1024 });
  assert.ok(err, 'expected error for .doc file');
});
test('rejects null file', () => {
  const err = v.validateUploadFile(null);
  assert.ok(err, 'expected error for null');
});

// ---- Last4 extraction ----
console.log('\nLast4 extraction:');
test('extracts last4 from SSN 123-45-6789 -> 6789', () => assert.equal(v.extractLast4SSN('123-45-6789'), '6789'));
test('extracts last4 from routing 121000358 -> 0358', () => assert.equal(v.extractLast4Routing('121000358'), '0358'));
test('extracts last4 from account 123456789 -> 6789', () => assert.equal(v.extractLast4Account('123456789'), '6789'));

// ---- time_commitment_bucket validation ----
console.log('\ntime_commitment_bucket validation:');
const VALID_BUCKETS = ['under_15', '15_to_25', '25_to_35', 'over_35'];
if (v.validateTimeBucket) {
  VALID_BUCKETS.forEach((b) => {
    test(`accepts valid bucket "${b}"`, () => assert.equal(v.validateTimeBucket(b), true));
  });
  test('rejects bucket "40_hours"', () => assert.equal(v.validateTimeBucket('40_hours'), false));
  test('rejects bucket empty string', () => assert.equal(v.validateTimeBucket(''), false));
  test('rejects bucket null', () => assert.equal(v.validateTimeBucket(null), false));
} else {
  test('validateTimeBucket exported', () => {
    throw new Error('validateTimeBucket not exported');
  });
}

// ---- Full form validation ----
console.log('\nFull form validateOnboarding:');

const validProfLicense = {
  type: 'RN',
  number: 'RN1234567',
  status: 'Active',
  expiration: fmt(futureDate),
  license_url: 'https://rn.ca.gov/verify/RN1234567',
};

const validForm = {
  first_name: 'Jane',
  last_name: 'Doe',
  mobile_phone: '3105551234',
  date_of_birth: fmt(adult),
  address_street: '123 Main St',
  address_city: 'Los Angeles',
  address_state: 'CA',
  address_zip: '90210',
  tin_type: 'SSN',
  tin_raw: '123-45-6789',
  w9_tax_classification: 'individual',
  driver_license_number: 'D1234567',
  driver_license_state: 'CA',
  professional_licenses: [validProfLicense],
  bank_name: 'Wells Fargo',
  bank_account_owner_name: 'Jane Doe',
  prof_liability_per_occurrence: 1000000,
  prof_liability_aggregate: 3000000,
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

test('missing last_name fails', () => {
  const form = { ...validForm, last_name: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.last_name, 'expected last_name error');
});

test('missing mobile_phone fails (now required)', () => {
  const form = { ...validForm };
  delete form.mobile_phone;
  const errors = v.validateOnboarding(form);
  assert.ok(errors.mobile_phone, 'mobile_phone should be required');
});

test('invalid mobile_phone fails when provided', () => {
  const form = { ...validForm, mobile_phone: '12345' }; // too short
  const errors = v.validateOnboarding(form);
  assert.ok(errors.mobile_phone, 'expected mobile_phone error');
});

test('valid mobile_phone passes when provided', () => {
  const form = { ...validForm, mobile_phone: '3105551234' };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.mobile_phone, 'valid mobile_phone should not error');
});

test('missing driver_license_number fails', () => {
  const form = { ...validForm, driver_license_number: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.driver_license_number, 'expected driver_license_number error');
});

test('missing driver_license_state fails', () => {
  const form = { ...validForm, driver_license_state: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.driver_license_state, 'expected driver_license_state error');
});

test('invalid driver_license_state fails', () => {
  const form = { ...validForm, driver_license_state: 'ZZ' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.driver_license_state, 'expected driver_license_state error');
});

test('empty professional_licenses array fails', () => {
  const form = { ...validForm, professional_licenses: [] };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.professional_licenses, 'expected professional_licenses error');
});

test('missing professional_licenses fails', () => {
  const form = { ...validForm };
  delete form.professional_licenses;
  const errors = v.validateOnboarding(form);
  assert.ok(errors.professional_licenses, 'expected professional_licenses error');
});

test('invalid license entry in array fails', () => {
  const badLic = { ...validProfLicense, expiration: fmt(pastDate) };
  const form = { ...validForm, professional_licenses: [badLic] };
  const errors = v.validateOnboarding(form);
  assert.ok(errors['professional_licenses_0'], 'expected nested license error');
});

test('multiple licenses: second invalid fails correctly', () => {
  const badLic = { ...validProfLicense, number: '' };
  const form = { ...validForm, professional_licenses: [validProfLicense, badLic] };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors['professional_licenses_0'], 'first license should be valid');
  assert.ok(errors['professional_licenses_1'], 'expected error on second license');
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

// ---- Zelle form variant ----
console.log('\nFull form validateOnboarding (Zelle variant):');
const validFormZelle = {
  first_name: 'Jane',
  last_name: 'Doe',
  mobile_phone: '3105551234',
  date_of_birth: fmt(adult),
  address_street: '123 Main St',
  address_city: 'Los Angeles',
  address_state: 'CA',
  address_zip: '90210',
  tin_type: 'SSN',
  tin_raw: '123-45-6789',
  w9_tax_classification: 'individual',
  driver_license_number: 'D1234567',
  driver_license_state: 'CA',
  professional_licenses: [validProfLicense],
  prof_liability_per_occurrence: 1000000,
  prof_liability_aggregate: 3000000,
  bank_name: 'Wells Fargo',
  bank_account_owner_name: 'Jane Doe',
  payment_method: 'zelle',
  zelle_contact: 'jane@example.com',
  time_commitment_bucket: '15_to_25',
  attestation_checked: true,
  attestation_signature: 'Jane Doe',
  attestation_date: fmt(today),
};

test('valid Zelle form passes', () => {
  const errors = v.validateOnboarding(validFormZelle);
  assert.deepStrictEqual(errors, {});
});

test('valid bucket "15_to_25" passes full form', () => {
  const errors = v.validateOnboarding(validFormZelle);
  assert.ok(!errors.time_commitment_bucket, `unexpected error: ${errors.time_commitment_bucket}`);
});

test('missing time_commitment_bucket fails', () => {
  const form = { ...validFormZelle, time_commitment_bucket: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.time_commitment_bucket, 'expected time_commitment_bucket error');
});

test('invalid bucket string fails', () => {
  const form = { ...validFormZelle, time_commitment_bucket: 'part_time' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.time_commitment_bucket, 'expected time_commitment_bucket error');
});

// ---- payment_method enum (zelle | ach) ----
console.log('\npayment_method enum validation:');
test('payment_method "zelle" passes', () => {
  const form = { ...validFormZelle, payment_method: 'zelle', zelle_contact: 'jane@example.com' };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.payment_method, `unexpected error: ${errors.payment_method}`);
});
test('payment_method "ach" passes', () => {
  const form = {
    ...validFormZelle,
    payment_method: 'ach',
    bank_routing_raw: '121000358',
    bank_account_raw: '12345678',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.payment_method, `unexpected error: ${errors.payment_method}`);
});
test('payment_method "direct_deposit" rejected', () => {
  const form = { ...validFormZelle, payment_method: 'direct_deposit' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.payment_method, 'expected payment_method error');
});
test('payment_method "check" rejected', () => {
  const form = { ...validFormZelle, payment_method: 'check' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.payment_method, 'expected payment_method error');
});

// ---- Conditional ACH validation ----
console.log('\nConditional ACH validation:');
test('ACH missing routing → error', () => {
  const form = {
    ...validFormZelle,
    payment_method: 'ach',
    bank_routing_raw: '',
    bank_account_raw: '12345678',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.bank_routing_raw, 'expected bank_routing_raw error for ACH');
});
test('ACH missing account → error', () => {
  const form = {
    ...validFormZelle,
    payment_method: 'ach',
    bank_routing_raw: '121000358',
    bank_account_raw: '',
  };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.bank_account_raw, 'expected bank_account_raw error for ACH');
});
test('Zelle missing routing → OK (not required)', () => {
  const form = {
    ...validFormZelle,
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
    ...validFormZelle,
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
  const form = { ...validFormZelle, payment_method: 'zelle', zelle_contact: '' };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.zelle_contact, 'expected zelle_contact error');
});
test('Zelle with zelle_contact → no error', () => {
  const form = { ...validFormZelle, payment_method: 'zelle', zelle_contact: 'jane@example.com' };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.zelle_contact, `unexpected zelle_contact error: ${errors.zelle_contact}`);
});

// ---- Insurance expiration (optional but validated if provided) ----
console.log('\nInsurance expiration validation:');
test('future insurance_expiration passes', () => {
  const form = { ...validForm, insurance_expiration: fmt(futureDate) };
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.insurance_expiration, 'future date should be valid');
});
test('past insurance_expiration fails', () => {
  const form = { ...validForm, insurance_expiration: fmt(pastDate) };
  const errors = v.validateOnboarding(form);
  assert.ok(errors.insurance_expiration, 'past date should fail');
});
test('absent insurance_expiration passes (optional)', () => {
  const form = { ...validForm };
  delete form.insurance_expiration;
  const errors = v.validateOnboarding(form);
  assert.ok(!errors.insurance_expiration, 'insurance_expiration should be optional');
});

// ---- PROF_LICENSE_TYPES and PROF_LICENSE_STATUSES exports ----
console.log('\nExported constants:');
test('PROF_LICENSE_TYPES is a Set with RN', () => {
  assert.ok(v.PROF_LICENSE_TYPES instanceof Set, 'should be a Set');
  assert.ok(v.PROF_LICENSE_TYPES.has('RN'), 'should have RN');
});
test('PROF_LICENSE_STATUSES is a Set with Active', () => {
  assert.ok(v.PROF_LICENSE_STATUSES instanceof Set, 'should be a Set');
  assert.ok(v.PROF_LICENSE_STATUSES.has('Active'), 'should have Active');
});
test('PAYMENT_METHODS has zelle and ach', () => {
  assert.ok(v.PAYMENT_METHODS.has('zelle'), 'should have zelle');
  assert.ok(v.PAYMENT_METHODS.has('ach'), 'should have ach');
});
test('TIME_COMMITMENT_BUCKETS has all 4 values', () => {
  assert.equal(v.TIME_COMMITMENT_BUCKETS.size, 4, 'should have 4 buckets');
});

// ---- Summary ----
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
