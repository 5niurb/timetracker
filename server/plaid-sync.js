'use strict';

const { syncTransactions } = require('./plaid-client');
const { updateRenderEnvVar } = require('./render-api');

// Build a Map from match-key (lowercase) → employee_id.
// Uses zelle_name if set and non-empty, otherwise full name.
// Keys shorter than 5 characters are skipped to prevent false-positive matches.
function buildMatchMap(employees) {
  const map = new Map();
  for (const emp of employees) {
    const zelleKey = (emp.zelle_name || '').trim();
    const key = (zelleKey || emp.name || '').trim().toLowerCase();
    if (key && key.length >= 5) map.set(key, emp.id);
  }
  return map;
}

// Match a transaction description against the map.
// Returns employee_id or null.
function matchTransaction(description, map) {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const [key, empId] of map) {
    if (lower.includes(key)) return empId;
  }
  return null;
}

// Classify an array of Plaid transactions into matched + unmatched.
function classifyTransactions(transactions, matchMap) {
  const matched = [];
  const unmatched = [];

  for (const tx of transactions) {
    const empId = matchTransaction(tx.name, matchMap);
    if (empId !== null) {
      matched.push({
        employee_id: empId,
        plaid_transaction_id: tx.transaction_id,
        transaction_date: tx.date,
        amount: tx.amount,
        description: tx.name,
      });
    } else {
      unmatched.push({
        plaid_transaction_id: tx.transaction_id,
        transaction_date: tx.date,
        amount: tx.amount,
        description: tx.name,
      });
    }
  }

  return { matched, unmatched };
}

// Full sync: fetch from Plaid, match, upsert to DB, advance cursor.
// Returns { matchedCount, pendingCount, newCursor, errors }
async function runSync(supabase) {
  const accessToken = process.env.PLAID_ACCESS_TOKEN;
  const cursor = process.env.PLAID_CURSOR || null;

  if (!accessToken) {
    throw new Error('Bank account not connected. Set PLAID_ACCESS_TOKEN via Link flow.');
  }

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, name, zelle_name')
    .eq('status', 'active');

  if (empError) throw new Error('Failed to load employees: ' + empError.message);

  const matchMap = buildMatchMap(employees);

  if (matchMap.size === 0) {
    console.warn('Warning: no active employees with valid match keys — all transactions will be pending');
  }

  // IMPORTANT: If syncTransactions throws mid-pagination, use the last persisted
  // cursor on retry — not the original cursor passed in.
  const { added, nextCursor } = await syncTransactions(accessToken, cursor);
  const { matched, unmatched } = classifyTransactions(added, matchMap);
  const errors = [];

  for (const tx of matched) {
    const { error } = await supabase.from('payments').upsert(
      {
        employee_id: tx.employee_id,
        payment_date: tx.transaction_date,
        amount: tx.amount,
        notes: tx.description,
        payment_type: 'direct_deposit',
        source: 'plaid',
        auto_imported: true,
        plaid_transaction_id: tx.plaid_transaction_id,
      },
      { onConflict: 'plaid_transaction_id', ignoreDuplicates: true },
    );
    if (error && !error.message.includes('duplicate')) {
      errors.push(`Failed to upsert payment for tx ${tx.plaid_transaction_id}: ${error.message}`);
    }
  }

  for (const tx of unmatched) {
    const { error } = await supabase.from('plaid_pending').upsert(
      {
        plaid_transaction_id: tx.plaid_transaction_id,
        transaction_date: tx.transaction_date,
        amount: tx.amount,
        description: tx.description,
      },
      { onConflict: 'plaid_transaction_id', ignoreDuplicates: true },
    );
    if (error && !error.message.includes('duplicate')) {
      errors.push(`Failed to upsert pending tx ${tx.plaid_transaction_id}: ${error.message}`);
    }
  }

  // Advance cursor — non-fatal if Render API write fails
  if (nextCursor && nextCursor !== cursor) {
    try {
      await updateRenderEnvVar('PLAID_CURSOR', nextCursor);
    } catch (e) {
      console.warn('Warning: failed to update PLAID_CURSOR in Render:', e.message);
      errors.push('Cursor update failed (non-fatal): ' + e.message);
    }
  }

  return {
    matchedCount: matched.length,
    pendingCount: unmatched.length,
    newCursor: nextCursor,
    errors,
  };
}

module.exports = { buildMatchMap, matchTransaction, classifyTransactions, runSync };
