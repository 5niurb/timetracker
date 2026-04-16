'use strict';

/**
 * Server-side validation for worker onboarding form.
 * Also imported by test suite (Node.js) and referenced by client-side inline validation.
 */

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/** SSN format: ###-##-#### */
function validateSSN(val) {
  return /^\d{3}-\d{2}-\d{4}$/.test(val);
}

/** EIN format: ##-####### */
function validateEIN(val) {
  return /^\d{2}-\d{7}$/.test(val);
}

/** ZIP: 5 digits or 9 digits (with or without dash) */
function validateZip(val) {
  return /^\d{5}(-\d{4})?$/.test(val) || /^\d{9}$/.test(val);
}

/** Phone: at least 10 digits when stripped of formatting, max 15 */
function validatePhone(val) {
  if (!val) return false;
  const digits = val.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/** US state: exactly 2 uppercase letters from allowlist */
function validateState(val) {
  return US_STATES.has(val);
}

/**
 * ABA routing number checksum.
 * Checksum: (3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9)) mod 10 === 0
 */
function validateBankRouting(val) {
  if (!/^\d{9}$/.test(val)) return false;
  const d = val.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** Bank account: 4–17 digits */
function validateBankAccount(val) {
  return /^\d{4,17}$/.test(val);
}

/**
 * Date of birth: must be in the past and worker must be ≥18 years old.
 * @param {string} val - ISO date string YYYY-MM-DD
 */
function validateDOB(val) {
  if (!val) return false;
  const dob = new Date(val);
  if (isNaN(dob)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dob >= today) return false;
  // Age check: 18 years
  const age18 = new Date(dob);
  age18.setFullYear(age18.getFullYear() + 18);
  return age18 <= today;
}

/**
 * Future date: must be strictly after today (for license/insurance expiration).
 * @param {string} val - ISO date string YYYY-MM-DD
 */
function validateFutureDate(val) {
  if (!val) return false;
  const d = new Date(val);
  if (isNaN(d)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d > today;
}

/** Extract last 4 digits of SSN (strip dashes first) */
function extractLast4SSN(ssn) {
  return ssn.replace(/\D/g, '').slice(-4);
}

/** Extract last 4 digits of routing number */
function extractLast4Routing(routing) {
  return routing.replace(/\D/g, '').slice(-4);
}

/** Extract last 4 digits of bank account number */
function extractLast4Account(account) {
  return account.replace(/\D/g, '').slice(-4);
}

/** Valid time commitment buckets */
const TIME_COMMITMENT_BUCKETS = new Set(['under_15', '15_to_25', '25_to_35', 'over_35']);

/** Valid payment methods */
const PAYMENT_METHODS = new Set(['zelle', 'ach']);

/**
 * Validate time commitment bucket enum.
 * @param {string} val
 * @returns {boolean}
 */
function validateTimeBucket(val) {
  if (!val) return false;
  return TIME_COMMITMENT_BUCKETS.has(val);
}

/**
 * Validate the full onboarding form.
 * @param {Object} form - flat object of form fields
 * @returns {Object} errors map — empty object means valid
 */
function validateOnboarding(form) {
  const errors = {};

  function required(field, label) {
    if (!form[field] || String(form[field]).trim() === '') {
      errors[field] = `${label} is required`;
    }
  }

  // Identity
  required('first_name', 'First name');
  required('last_name', 'Last name');

  if (form.home_phone && !validatePhone(form.home_phone)) {
    errors.home_phone = 'Invalid phone number';
  }
  if (form.work_phone && !validatePhone(form.work_phone)) {
    errors.work_phone = 'Invalid phone number';
  }

  if (form.date_of_birth) {
    if (!validateDOB(form.date_of_birth)) {
      errors.date_of_birth = 'Must be at least 18 years old and not in the future';
    }
  }

  // Address
  required('address_street', 'Street address');
  required('address_city', 'City');
  if (!form.address_state || !validateState(form.address_state)) {
    errors.address_state = 'Valid US state required (2-letter code)';
  }
  if (!form.address_zip || !validateZip(form.address_zip)) {
    errors.address_zip = 'Valid ZIP code required (5 or 9 digits)';
  }

  // Tax (W-9)
  required('tin_type', 'TIN type');
  if (form.tin_raw) {
    if (form.tin_type === 'SSN' && !validateSSN(form.tin_raw)) {
      errors.tin_raw = 'SSN must be in format 123-45-6789';
    } else if (form.tin_type === 'EIN' && !validateEIN(form.tin_raw)) {
      errors.tin_raw = 'EIN must be in format 12-3456789';
    }
  } else {
    errors.tin_raw = 'Tax ID number is required';
  }
  required('w9_tax_classification', 'W-9 tax classification');
  required('w9_signed_at', 'W-9 signature date');

  // License expiration (optional, but if provided must be future)
  if (form.license_expiration && !validateFutureDate(form.license_expiration)) {
    errors.license_expiration = 'License expiration must be in the future';
  }
  if (form.driver_license_expiry && !validateFutureDate(form.driver_license_expiry)) {
    errors.driver_license_expiry = "Driver's license must not be expired";
  }
  if (form.insurance_expiration && !validateFutureDate(form.insurance_expiration)) {
    errors.insurance_expiration = 'Insurance expiration must be in the future';
  }

  // Banking
  required('bank_name', 'Bank name');
  required('bank_account_owner_name', 'Account owner name');

  // Payment method: only 'zelle' or 'ach' accepted
  if (!form.payment_method || !PAYMENT_METHODS.has(form.payment_method)) {
    errors.payment_method = 'Payment method must be Zelle or ACH';
  }

  // ACH: routing + account required; Zelle: ignored even if submitted
  if (form.payment_method === 'ach') {
    if (form.bank_routing_raw && !validateBankRouting(form.bank_routing_raw)) {
      errors.bank_routing_raw = 'Invalid routing number (must be 9 digits with valid ABA checksum)';
    } else if (!form.bank_routing_raw) {
      errors.bank_routing_raw = 'Routing number is required for ACH';
    }

    if (form.bank_account_raw && !validateBankAccount(form.bank_account_raw)) {
      errors.bank_account_raw = 'Account number must be 4–17 digits';
    } else if (!form.bank_account_raw) {
      errors.bank_account_raw = 'Account number is required for ACH';
    }
  } else if (form.payment_method === 'zelle') {
    // Validate routing format only if supplied (optional for Zelle)
    if (form.bank_routing_raw && !validateBankRouting(form.bank_routing_raw)) {
      errors.bank_routing_raw = 'Invalid routing number (must be 9 digits with valid ABA checksum)';
    }
    if (form.bank_account_raw && !validateBankAccount(form.bank_account_raw)) {
      errors.bank_account_raw = 'Account number must be 4–17 digits';
    }
  }

  if (form.payment_method === 'zelle' && !form.zelle_contact) {
    errors.zelle_contact = 'Zelle phone or email is required';
  }

  // Time commitment bucket (required enum)
  if (!form.time_commitment_bucket || !TIME_COMMITMENT_BUCKETS.has(form.time_commitment_bucket)) {
    errors.time_commitment_bucket = 'Time commitment selection is required';
  }

  // Attestation
  if (!form.attestation_checked) {
    errors.attestation_checked = 'You must certify the information is accurate';
  }
  required('attestation_signature', 'Typed signature');
  required('attestation_date', 'Signature date');

  return errors;
}

module.exports = {
  validateSSN,
  validateEIN,
  validateZip,
  validatePhone,
  validateState,
  validateBankRouting,
  validateBankAccount,
  validateDOB,
  validateFutureDate,
  validateTimeBucket,
  extractLast4SSN,
  extractLast4Routing,
  extractLast4Account,
  validateOnboarding,
  TIME_COMMITMENT_BUCKETS,
  PAYMENT_METHODS,
};
