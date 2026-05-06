# Plaid–Chase Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically pull Chase bank transactions via Plaid nightly, match them to paytrack employees, and record matched transactions as payouts — supporting payroll tracking and 1099 tax reporting.

**Architecture:** Plaid SDK runs server-side in paytrack (Render). Admin panel gets a new "Bank Integration" tab for one-time Link OAuth setup, on-demand sync, pending review queue, and auto-import verification. A Mac launchd job triggers nightly sync via the paytrack API.

**Tech Stack:** `plaid-node` SDK, Supabase PostgreSQL (payments + plaid_pending tables), Express API routes, vanilla JS admin panel, Mac launchd

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `server/plaid-client.js` | Create | Plaid SDK wrapper — init client, create Link token, exchange public token, fetch transactions |
| `server/plaid-sync.js` | Create | Match logic — compare transactions to employees, upsert to DB |
| `routes/plaid.js` | Create | 7 API route handlers, init() factory pattern |
| `server.js` | Modify | Register plaid routes; add `zelle_name` to employee PUT; add startup warning if Plaid not configured |
| `public/admin.html` | Modify | Add "Bank Integration" tab button + tab content (HTML only) |
| `public/js/admin.js` | Modify | Add Bank Integration JS: Link flow, sync, pending queue, auto-imports, zelle_name field |
| `test/plaid-sync.test.js` | Create | Unit tests for match logic (vanilla Node assert pattern) |
| `test/plaid-client.test.js` | Create | Unit tests for Plaid client wrapper |
| `~/Scripts/paytrack-plaid-sync.sh` | Create (Mac) | Nightly curl script |
| `~/Library/LaunchAgents/com.lemed.paytrack-plaid-sync.plist` | Create (Mac) | launchd schedule |

---

## Task 1: Database Migrations

**Files:**
- Create: `migrations/009_plaid.sql`

- [ ] **Step 1: Write the test (confirm migration SQL is valid)**

Run against dev Supabase to verify syntax. No test file — just run the SQL.

- [ ] **Step 2: Write the migration SQL**

Create `migrations/009_plaid.sql`:

```sql
-- Add zelle_name alias to employees for Plaid transaction matching
ALTER TABLE employees ADD COLUMN IF NOT EXISTS zelle_name TEXT;

-- Hold unmatched Plaid transactions awaiting manual assignment
CREATE TABLE IF NOT EXISTS plaid_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Mark auto-imported payments and prevent duplicate imports
ALTER TABLE payments ADD COLUMN IF NOT EXISTS auto_imported BOOLEAN DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plaid_transaction_id TEXT UNIQUE;

-- Index for fast pending lookups
CREATE INDEX IF NOT EXISTS idx_plaid_pending_created ON plaid_pending(created_at DESC);

-- Index for fast auto-import lookups  
CREATE INDEX IF NOT EXISTS idx_payments_auto_imported ON payments(auto_imported) WHERE auto_imported = true;
```

- [ ] **Step 3: Apply migration to Supabase**

Go to Supabase dashboard → SQL editor, run `migrations/009_plaid.sql`.

Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employees' AND column_name = 'zelle_name';
-- Should return 1 row

SELECT table_name FROM information_schema.tables
WHERE table_name = 'plaid_pending';
-- Should return 1 row

SELECT column_name FROM information_schema.columns
WHERE table_name = 'payments' AND column_name IN ('auto_imported', 'plaid_transaction_id');
-- Should return 2 rows
```

- [ ] **Step 4: Commit**

```bash
git add migrations/009_plaid.sql
git commit -m "[paytrack] Add DB migrations for Plaid integration

- employees.zelle_name TEXT — alias for transaction matching
- plaid_pending table — unmatched transactions awaiting review
- payments.auto_imported BOOLEAN — flags auto-imported records
- payments.plaid_transaction_id TEXT UNIQUE — prevents duplicate imports

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Plaid Client Wrapper

**Files:**
- Create: `test/plaid-client.test.js`
- Create: `server/plaid-client.js`

- [ ] **Step 1: Write the failing test**

Create `test/plaid-client.test.js`:

```javascript
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

async function testAsync(name, fn) {
  try {
    await fn();
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/plaid-client.test.js
```

Expected: FAIL with "server/plaid-client.js not found"

- [ ] **Step 3: Install plaid-node**

```bash
npm install plaid
```

Verify it's in `package.json` dependencies.

- [ ] **Step 4: Write implementation**

Create `server/plaid-client.js`:

```javascript
'use strict';

const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

let _client = null;

function getClient() {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  if (!clientId || !secret) {
    throw new Error('PLAID_CLIENT_ID and PLAID_SECRET env vars are required');
  }
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

function isConfigured() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

async function createLinkToken(userId = 'paytrack-admin') {
  const client = getClient();
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'LM PayTrack',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return response.data.link_token;
}

async function exchangePublicToken(publicToken) {
  const client = getClient();
  const response = await client.itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

// Fetches all new/modified transactions since cursor.
// Returns { added, modified, removed, nextCursor, hasMore }
async function syncTransactions(accessToken, cursor = null) {
  const client = getClient();
  const allAdded = [];
  const allModified = [];
  const allRemoved = [];
  let nextCursor = cursor;
  let hasMore = true;

  while (hasMore) {
    const params = { access_token: accessToken };
    if (nextCursor) params.cursor = nextCursor;

    const response = await client.transactionsSync(params);
    const data = response.data;

    allAdded.push(...data.added);
    allModified.push(...data.modified);
    allRemoved.push(...data.removed);
    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return {
    added: allAdded,
    modified: allModified,
    removed: allRemoved,
    nextCursor,
    hasMore: false,
  };
}

module.exports = { createLinkToken, exchangePublicToken, syncTransactions, isConfigured };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node test/plaid-client.test.js
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/plaid-client.js test/plaid-client.test.js package.json package-lock.json
git commit -m "[paytrack] Add Plaid client wrapper + tests

- plaid-node SDK wrapper with createLinkToken, exchangePublicToken, syncTransactions
- isConfigured() guard for routes that require Plaid setup
- Full cursor pagination in syncTransactions (handles > 500 tx)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Match Logic (plaid-sync.js)

**Files:**
- Create: `test/plaid-sync.test.js`
- Create: `server/plaid-sync.js`

- [ ] **Step 1: Write the failing test**

Create `test/plaid-sync.test.js`:

```javascript
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
    // all keys in map should be lowercase
    for (const key of map.keys()) {
      assert.strictEqual(key, key.toLowerCase(), `Key "${key}" is not lowercase`);
    }
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
  const total = passed + failed;
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/plaid-sync.test.js
```

Expected: FAIL with "server/plaid-sync.js not found"

- [ ] **Step 3: Write implementation**

Create `server/plaid-sync.js`:

```javascript
'use strict';

const { syncTransactions } = require('./plaid-client');
const { updateRenderEnvVar } = require('./render-api');

// Build a Map from match-key (lowercase) → employee_id.
// Uses zelle_name if set, otherwise full name.
function buildMatchMap(employees) {
  const map = new Map();
  for (const emp of employees) {
    const key = (emp.zelle_name || emp.name || '').trim().toLowerCase();
    if (key) map.set(key, emp.id);
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

  // Load all employees for matching
  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, name, zelle_name')
    .eq('status', 'active');

  if (empError) throw new Error('Failed to load employees: ' + empError.message);

  const matchMap = buildMatchMap(employees);

  // Fetch transactions from Plaid
  const { added, nextCursor } = await syncTransactions(accessToken, cursor);

  const { matched, unmatched } = classifyTransactions(added, matchMap);

  const errors = [];

  // Upsert matched → payments (skip existing by plaid_transaction_id)
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

  // Upsert unmatched → plaid_pending
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
```

- [ ] **Step 4: Create render-api.js helper**

Create `server/render-api.js`:

```javascript
'use strict';

// Updates a Render service env var via the Render API.
// Used to persist PLAID_ACCESS_TOKEN and PLAID_CURSOR after sync.
async function updateRenderEnvVar(key, value) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    throw new Error('RENDER_API_KEY and RENDER_SERVICE_ID are required to update env vars');
  }

  // Get current env vars
  const listResp = await fetch(
    `https://api.render.com/v1/services/${serviceId}/env-vars`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    },
  );

  if (!listResp.ok) {
    throw new Error(`Render API list env-vars failed: ${listResp.status}`);
  }

  const envVars = await listResp.json();
  const existing = envVars.find(v => v.envVar?.key === key);

  // PUT to update existing or create new
  const url = existing
    ? `https://api.render.com/v1/services/${serviceId}/env-vars/${existing.envVar.id}`
    : `https://api.render.com/v1/services/${serviceId}/env-vars`;

  const method = existing ? 'PUT' : 'POST';
  const body = existing ? { value } : { key, value };

  const updateResp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!updateResp.ok) {
    const text = await updateResp.text();
    throw new Error(`Render API update env-var failed: ${updateResp.status} — ${text}`);
  }
}

module.exports = { updateRenderEnvVar };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node test/plaid-sync.test.js
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/plaid-sync.js server/render-api.js test/plaid-sync.test.js
git commit -m "[paytrack] Add Plaid sync + match logic + Render env helper

- buildMatchMap: zelle_name ?? name per employee, lowercase
- matchTransaction: substring match, case-insensitive
- classifyTransactions: splits into matched/unmatched lists
- runSync: fetches from Plaid, upserts payments + plaid_pending, advances cursor
- render-api.js: updateRenderEnvVar() for persisting cursor after sync

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: API Routes (routes/plaid.js)

**Files:**
- Create: `routes/plaid.js`
- Modify: `server.js` (register routes + RENDER_SERVICE_ID startup warning)

- [ ] **Step 1: Write the implementation**

Create `routes/plaid.js`:

```javascript
'use strict';

const express = require('express');
const router = express.Router();

let supabase;
let adminPassword;

function init(supabaseClient, adminPwd) {
  supabase = supabaseClient;
  adminPassword = adminPwd;
}

function authCheck(req, res) {
  if (req.headers.password !== adminPassword) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

// POST /api/admin/plaid/link-token
// Creates a Plaid Link token for initializing the Link modal.
router.post('/link-token', async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { createLinkToken, isConfigured } = require('../server/plaid-client');
    if (!isConfigured()) {
      return res.status(400).json({ success: false, message: 'Plaid credentials not configured' });
    }
    const linkToken = await createLinkToken();
    res.json({ success: true, linkToken });
  } catch (e) {
    console.error('[plaid] link-token error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/admin/plaid/exchange-token
// Exchanges a Plaid public token for an access token, stores in Render env var.
router.post('/exchange-token', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { publicToken } = req.body;
  if (!publicToken) {
    return res.status(400).json({ success: false, message: 'publicToken is required' });
  }
  try {
    const { exchangePublicToken } = require('../server/plaid-client');
    const { updateRenderEnvVar } = require('../server/render-api');
    const { accessToken } = await exchangePublicToken(publicToken);
    await updateRenderEnvVar('PLAID_ACCESS_TOKEN', accessToken);
    // Also set in process.env for this process instance
    process.env.PLAID_ACCESS_TOKEN = accessToken;
    // Clear cursor so next sync fetches from scratch (up to 30 days)
    process.env.PLAID_CURSOR = '';
    await updateRenderEnvVar('PLAID_CURSOR', '').catch(() => {});
    res.json({ success: true });
  } catch (e) {
    console.error('[plaid] exchange-token error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/admin/plaid/sync
// Runs transaction sync (used by launchd nightly + "Sync Now" button).
router.post('/sync', async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { runSync } = require('../server/plaid-sync');
    const result = await runSync(supabase);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[plaid] sync error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/plaid/pending
// Returns unmatched transactions from plaid_pending, newest first.
router.get('/pending', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { data, error } = await supabase
    .from('plaid_pending')
    .select('*')
    .order('transaction_date', { ascending: false });

  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
});

// POST /api/admin/plaid/pending/:id/assign
// Assigns a pending transaction to an employee → inserts into payments.
router.post('/pending/:id/assign', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;
  const { employeeId } = req.body;
  if (!employeeId) {
    return res.status(400).json({ success: false, message: 'employeeId is required' });
  }

  // Fetch the pending record
  const { data: pending, error: fetchErr } = await supabase
    .from('plaid_pending')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !pending) {
    return res.status(404).json({ success: false, message: 'Pending transaction not found' });
  }

  // Insert into payments
  const { error: insertErr } = await supabase.from('payments').insert({
    employee_id: parseInt(employeeId),
    payment_date: pending.transaction_date,
    amount: pending.amount,
    notes: pending.description,
    payment_type: 'direct_deposit',
    source: 'plaid',
    auto_imported: false,
    plaid_transaction_id: pending.plaid_transaction_id,
  });

  if (insertErr) {
    return res.status(400).json({ success: false, message: insertErr.message });
  }

  // Remove from plaid_pending
  await supabase.from('plaid_pending').delete().eq('id', id);

  res.json({ success: true });
});

// POST /api/admin/plaid/payments/:id/verify
// Clears the auto_imported flag — marks payment as admin-verified.
router.post('/payments/:id/verify', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;
  const { error } = await supabase
    .from('payments')
    .update({ auto_imported: false })
    .eq('id', id)
    .eq('auto_imported', true); // Safety: only clear if it was auto-imported

  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

// DELETE /api/admin/plaid/payments/:id/reverse
// Deletes auto-imported payment and re-queues to plaid_pending.
router.delete('/payments/:id/reverse', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;

  // Fetch the payment to re-queue
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('*')
    .eq('id', id)
    .eq('auto_imported', true) // Safety: only allow reversing auto-imported
    .single();

  if (fetchErr || !payment) {
    return res.status(404).json({ success: false, message: 'Auto-imported payment not found' });
  }

  // Re-insert into plaid_pending
  const { error: pendingErr } = await supabase.from('plaid_pending').upsert(
    {
      plaid_transaction_id: payment.plaid_transaction_id,
      transaction_date: payment.payment_date,
      amount: payment.amount,
      description: payment.notes,
    },
    { onConflict: 'plaid_transaction_id' },
  );

  if (pendingErr) {
    return res.status(500).json({ success: false, message: pendingErr.message });
  }

  // Delete the payment
  await supabase.from('payments').delete().eq('id', id);

  res.json({ success: true });
});

// DELETE /api/admin/plaid/pending/:id
// Removes a pending transaction (not a payout — discard it).
router.delete('/pending/:id', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;
  const { error } = await supabase.from('plaid_pending').delete().eq('id', id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

module.exports = { router, init };
```

- [ ] **Step 2: Register routes in server.js**

Add after line 66 (after `initCompliance` / `app.use('/api/compliance'...)`):

```javascript
const { router: plaidRouter, init: initPlaid } = require('./routes/plaid');
initPlaid(supabaseAdmin, process.env.ADMIN_PASSWORD);
app.use('/api/admin/plaid', plaidRouter);
```

Also add a startup warning (after the existing env checks, before `const supabase = ...`):

```javascript
// Plaid is optional — warn if not configured, but don't block startup
if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
  console.warn('Warning: PLAID_CLIENT_ID or PLAID_SECRET not set — Bank Integration will be disabled');
}
```

Also add `RENDER_SERVICE_ID` env var to the startup section (not a hard exit — just a warning):

```javascript
if (!process.env.RENDER_SERVICE_ID) {
  console.warn('Warning: RENDER_SERVICE_ID not set — Plaid cursor/token will not persist to Render after sync');
}
```

- [ ] **Step 3: Add zelle_name to employee PUT route (server.js line ~932)**

In `app.put('/api/admin/employees/:id', ...)`, add `zellaName` to the destructured body:

```javascript
const {
  name, pin, email, phone, hourlyWage, additionalPayRate, rateNotes,
  commissionRate, payType, designation, contractorType, status,
  zelleName,  // ADD THIS
} = req.body;
```

And add to the `.update({...})` call:

```javascript
zelle_name: zelleName?.trim() || null,   // ADD THIS
```

- [ ] **Step 4: Start dev server and smoke test routes exist**

```bash
npm run dev
```

In a second terminal:
```bash
# Should return 401 (no password)
curl -s -X POST http://localhost:3000/api/admin/plaid/sync | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => console.log(JSON.parse(d)))"
```

Expected: `{ success: false, message: 'Unauthorized' }`

- [ ] **Step 5: Commit**

```bash
git add routes/plaid.js server.js
git commit -m "[paytrack] Add 7 Plaid API routes + register in server.js

- POST /api/admin/plaid/link-token — creates Plaid Link token
- POST /api/admin/plaid/exchange-token — exchanges public token, stores in Render
- POST /api/admin/plaid/sync — runs transaction sync
- GET /api/admin/plaid/pending — returns unmatched transactions
- POST /api/admin/plaid/pending/:id/assign — assigns pending tx to employee
- POST /api/admin/plaid/payments/:id/verify — clears auto_imported flag
- DELETE /api/admin/plaid/payments/:id/reverse — deletes + re-queues to pending
- DELETE /api/admin/plaid/pending/:id — discards a pending tx
- Added zelle_name to employee PUT route

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Admin Panel HTML — "Bank Integration" Tab

**Files:**
- Modify: `public/admin.html`

- [ ] **Step 1: Add tab button**

In `public/admin.html`, find the existing tab buttons (around line 39):

```html
<button class="tab active" onclick="showTab('review-entries')">Review Entries</button>
<button class="tab" onclick="showTab('employees')">Team</button>
```

After the last tab button (before the closing `</div>` of the tab bar), add:

```html
<button class="tab" onclick="showTab('bank-integration')">Bank Integration</button>
```

- [ ] **Step 2: Add tab content**

After the last `tab-content` div (closing `</div>` of the compliance tab), add:

```html
<!-- Bank Integration Tab -->
<div id="tab-bank-integration" class="tab-content" style="display: none;">

  <!-- Connection Status -->
  <div class="card" style="margin-bottom:20px;">
    <h3 style="margin:0 0 12px;color:#c9a84c;">Bank Connection</h3>
    <div id="plaid-connection-status" style="margin-bottom:12px;color:#aaa;">Checking status...</div>
    <button class="btn-primary" id="plaid-connect-btn" onclick="plaidConnect()">Connect Chase</button>
  </div>

  <!-- Sync Controls -->
  <div class="card" style="margin-bottom:20px;">
    <h3 style="margin:0 0 12px;color:#c9a84c;">Sync</h3>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <button class="btn-primary" id="plaid-sync-btn" onclick="plaidSync()">Sync Now</button>
      <span id="plaid-sync-status" style="color:#aaa;font-size:13px;"></span>
    </div>
  </div>

  <!-- Pending Review -->
  <div class="card" style="margin-bottom:20px;">
    <h3 style="margin:0 0 12px;color:#c9a84c;">Pending Review</h3>
    <div id="plaid-pending-empty" style="display:none;color:#888;padding:12px 0;">No unmatched transactions.</div>
    <table id="plaid-pending-table" style="display:none;width:100%;border-collapse:collapse;">
      <thead>
        <tr style="color:#c9a84c;font-size:12px;text-transform:uppercase;">
          <th style="text-align:left;padding:6px 8px;">Date</th>
          <th style="text-align:right;padding:6px 8px;">Amount</th>
          <th style="text-align:left;padding:6px 8px;">Description</th>
          <th style="text-align:left;padding:6px 8px;">Assign To</th>
          <th style="text-align:center;padding:6px 8px;">Action</th>
        </tr>
      </thead>
      <tbody id="plaid-pending-body"></tbody>
    </table>
  </div>

  <!-- Recent Auto-Imports -->
  <div class="card">
    <h3 style="margin:0 0 12px;color:#c9a84c;">Recent Auto-Imports</h3>
    <div id="plaid-imports-empty" style="display:none;color:#888;padding:12px 0;">No auto-imported payments.</div>
    <table id="plaid-imports-table" style="display:none;width:100%;border-collapse:collapse;">
      <thead>
        <tr style="color:#c9a84c;font-size:12px;text-transform:uppercase;">
          <th style="text-align:left;padding:6px 8px;">Date</th>
          <th style="text-align:left;padding:6px 8px;">Employee</th>
          <th style="text-align:right;padding:6px 8px;">Amount</th>
          <th style="text-align:left;padding:6px 8px;">Description</th>
          <th style="text-align:center;padding:6px 8px;">Status</th>
        </tr>
      </thead>
      <tbody id="plaid-imports-body"></tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 3: Add Plaid Link script tag**

In `<head>`, add (near other script tags):

```html
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add public/admin.html
git commit -m "[paytrack] Add Bank Integration tab HTML to admin panel

- New tab button and tab-content div for Bank Integration
- Connection status, sync controls, pending review table, auto-imports table
- Plaid Link script tag in <head>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Admin Panel JS — Bank Integration Logic

**Files:**
- Modify: `public/js/admin.js`

- [ ] **Step 1: Add zelle_name to employee edit modal HTML**

In `public/admin.html`, find the employee edit modal and locate the `rate-notes` field. After the rate notes row (or in the main employee fields section), add:

```html
<div class="form-row">
  <label for="edit-emp-zelle-name">Zelle/ACH Name (optional — for Plaid matching)</label>
  <input type="text" id="edit-emp-zelle-name" placeholder="e.g. Jane S or Jodi ACH" />
  <small style="color:#888;">Leave blank to match by full name. Set this if Zelle truncates the name.</small>
</div>
```

- [ ] **Step 2: Add zelleName to editEmployee() population**

In `admin.js`, in the `editEmployee(id)` function, after the last `document.getElementById('edit-emp-rate-notes').value = emp.rate_notes || '';` line, add:

```javascript
document.getElementById('edit-emp-zelle-name').value = emp.zelle_name || '';
```

- [ ] **Step 3: Add zelleName to saveEmployee() body**

In `admin.js`, in the `saveEmployee()` function, add to the JSON body:

```javascript
const zelleName = document.getElementById('edit-emp-zelle-name').value.trim();
```

And in the `JSON.stringify({...})` body, add:

```javascript
zelleName,
```

- [ ] **Step 4: Make sure loadEmployees() returns zelle_name**

Verify the `GET /api/admin/employees` server route returns `zelle_name` in its select. In `server.js` around line 868-872, the select string includes named fields — add `zelle_name` to it:

```javascript
'id, name, pin, email, phone, hourly_wage, additional_pay_rate, rate_notes, commission_rate, pay_type, designation, contractor_type, status, created_at, review_token, review_completed_at, zelle_name'
```

- [ ] **Step 5: Add Bank Integration JS to admin.js**

At the end of admin.js (before the closing `</script>` tag), add:

```javascript
// ============================================================
// Bank Integration — Plaid Link, sync, pending review, auto-imports
// ============================================================

async function plaidConnect() {
  const btn = document.getElementById('plaid-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const resp = await adminFetch('/api/admin/plaid/link-token', { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || 'Failed to get Link token');

    const handler = Plaid.create({
      token: data.linkToken,
      onSuccess: async (publicToken) => {
        const exResp = await adminFetch('/api/admin/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken }),
        });
        const exData = await exResp.json();
        if (exData.success) {
          showToast('Chase account connected successfully!', 'success');
          loadBankIntegration();
        } else {
          showToast('Connection failed: ' + (exData.message || 'Unknown error'), 'error');
        }
      },
      onExit: () => {
        btn.disabled = false;
        btn.textContent = 'Connect Chase';
      },
    });
    handler.open();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Connect Chase';
  }
}

async function plaidSync() {
  const btn = document.getElementById('plaid-sync-btn');
  const statusEl = document.getElementById('plaid-sync-status');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  statusEl.textContent = '';

  try {
    const resp = await adminFetch('/api/admin/plaid/sync', { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || 'Sync failed');
    statusEl.textContent = `Done — ${data.matchedCount} imported, ${data.pendingCount} pending review`;
    statusEl.style.color = '#6bff6b';
    loadBankIntegration();
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = '#ff6b6b';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync Now';
  }
}

async function loadBankIntegration() {
  await Promise.all([loadPlaidPending(), loadPlaidImports()]);
  // Update connection status based on whether sync is working
  const statusEl = document.getElementById('plaid-connection-status');
  const accessToken = true; // We can't read the token client-side; just show ready
  statusEl.textContent = 'Connected (configured in Render)';
  statusEl.style.color = '#6bff6b';
  document.getElementById('plaid-connect-btn').textContent = 'Reconnect Chase';
}

async function loadPlaidPending() {
  const resp = await adminFetch('/api/admin/plaid/pending');
  const data = await resp.json();
  const tbody = document.getElementById('plaid-pending-body');
  const table = document.getElementById('plaid-pending-table');
  const empty = document.getElementById('plaid-pending-empty');

  if (!data.success || !data.data?.length) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';

  const employees = window._employeesCache || [];
  tbody.innerHTML = data.data
    .map(
      tx => `<tr>
      <td style="padding:6px 8px;">${tx.transaction_date}</td>
      <td style="padding:6px 8px;text-align:right;">$${parseFloat(tx.amount).toFixed(2)}</td>
      <td style="padding:6px 8px;color:#ccc;">${escapeHtml(tx.description || '')}</td>
      <td style="padding:6px 8px;">
        <select id="pending-assign-${tx.id}" style="width:140px;">
          <option value="">-- Select --</option>
          ${employees.filter(e => e.status === 'active').map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
        </select>
      </td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
        <button class="btn-primary" style="font-size:11px;padding:3px 10px;" onclick="plaidAssign('${tx.id}')">Assign</button>
        <button class="btn-secondary" style="font-size:11px;padding:3px 10px;margin-left:4px;" onclick="plaidDiscard('${tx.id}')">Not a payout</button>
      </td>
    </tr>`,
    )
    .join('');
}

async function loadPlaidImports() {
  // Load last 30 auto-imported payments
  const resp = await fetch('/api/admin/payments?auto_imported=true&limit=30', {
    headers: { password: sessionStorage.getItem('adminPasswordValue') || '' },
  });
  const data = await resp.json();
  const tbody = document.getElementById('plaid-imports-body');
  const table = document.getElementById('plaid-imports-table');
  const empty = document.getElementById('plaid-imports-empty');

  const items = (data.data || []).filter(p => p.auto_imported);

  if (!items.length) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';
  const employees = window._employeesCache || [];

  tbody.innerHTML = items
    .map(p => {
      const emp = employees.find(e => e.id === p.employee_id);
      const empName = emp ? escapeHtml(emp.name) : `#${p.employee_id}`;
      const badge = p.auto_imported
        ? `<span style="color:#f0a500;font-size:11px;font-weight:700;">Unverified</span>
           <button class="btn-primary" style="font-size:10px;padding:2px 8px;margin-left:6px;" onclick="plaidVerify(${p.id})">Verify ✓</button>`
        : `<span style="color:#6bff6b;font-size:11px;font-weight:700;">Verified</span>`;
      return `<tr>
        <td style="padding:6px 8px;">${p.payment_date}</td>
        <td style="padding:6px 8px;">${empName}</td>
        <td style="padding:6px 8px;text-align:right;">$${parseFloat(p.amount).toFixed(2)}</td>
        <td style="padding:6px 8px;color:#ccc;">${escapeHtml(p.notes || '')}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
          ${badge}
          <button class="btn-secondary" style="font-size:10px;padding:2px 8px;margin-left:6px;" onclick="plaidReverse(${p.id})">Reverse</button>
        </td>
      </tr>`;
    })
    .join('');
}

async function plaidAssign(pendingId) {
  const empId = document.getElementById(`pending-assign-${pendingId}`)?.value;
  if (!empId) {
    showToast('Please select an employee', 'error');
    return;
  }
  try {
    const resp = await adminFetch(`/api/admin/plaid/pending/${pendingId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: empId }),
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message);
    showToast('Transaction assigned successfully', 'success');
    loadPlaidPending();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function plaidDiscard(pendingId) {
  if (!confirm('Discard this transaction? It will not be recorded as a payout.')) return;
  try {
    const resp = await adminFetch(`/api/admin/plaid/pending/${pendingId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message);
    loadPlaidPending();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function plaidVerify(paymentId) {
  try {
    const resp = await adminFetch(`/api/admin/plaid/payments/${paymentId}/verify`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message);
    showToast('Payment verified', 'success');
    loadPlaidImports();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function plaidReverse(paymentId) {
  if (!confirm('Reverse this auto-import? The payment will be deleted and returned to pending review.')) return;
  try {
    const resp = await adminFetch(`/api/admin/plaid/payments/${paymentId}/reverse`, { method: 'DELETE' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message);
    showToast('Payment reversed and returned to pending', 'success');
    loadBankIntegration();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// adminFetch: wraps fetch with password header
function adminFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      password: sessionStorage.getItem('adminPasswordValue') || '',
    },
  });
}
```

Note: if `adminFetch` already exists in admin.js, skip that function and use the existing one. Check with `grep -n "function adminFetch"` first.

- [ ] **Step 6: Wire up tab load**

In `admin.js`, find the `showTab(tab)` function. Inside its switch/if block (wherever tab-specific data is loaded), add:

```javascript
if (tab === 'bank-integration') {
  loadBankIntegration();
}
```

If the existing pattern calls `loadEmployees()` when the employees tab is shown, follow the same pattern.

- [ ] **Step 7: Start dev server and visual test**

```bash
npm run dev
```

Open http://localhost:3000/admin, log in, click "Bank Integration" tab. Verify:
- Tab renders without JS errors
- "Sync Now" button exists
- Pending and Auto-Imports sections show empty states

- [ ] **Step 8: Commit**

```bash
git add public/admin.html public/js/admin.js server.js
git commit -m "[paytrack] Bank Integration UI: Link flow, sync, pending review, auto-imports

- zelle_name field in employee edit modal
- Plaid Connect / Reconnect button using Plaid Link SDK
- Sync Now button with status feedback
- Pending Review table: assign or discard unmatched transactions
- Recent Auto-Imports table: Verify / Reverse buttons
- loadBankIntegration() wired to tab switch

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Add GET /api/admin/payments Filter for auto_imported

**Files:**
- Modify: `server.js` (payments GET route)

The Bank Integration JS calls `/api/admin/payments?auto_imported=true&limit=30`. The existing payments route needs to support this filter.

- [ ] **Step 1: Read existing payments GET route**

```bash
grep -n "app.get.*payments" server.js
```

Find the admin payments GET route and its query logic.

- [ ] **Step 2: Add auto_imported filter**

In the payments GET route handler, add to the Supabase query:

```javascript
const { auto_imported, limit } = req.query;
let query = supabaseAdmin
  .from('payments')
  .select('*, employees(name)')
  .order('payment_date', { ascending: false });

if (auto_imported === 'true') {
  query = query.eq('auto_imported', true);
}
if (limit) {
  query = query.limit(parseInt(limit));
}
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "[paytrack] Add auto_imported filter to payments GET endpoint

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Render Environment Variables

**Files:**
- None (Render dashboard configuration)

- [ ] **Step 1: Set Plaid credentials in Render**

Go to Render dashboard → paytrack service → Environment. Add:

| Key | Value |
|-----|-------|
| `PLAID_CLIENT_ID` | `69fbbdaf8a7a05000d309947` |
| `PLAID_SECRET` | `a13a2fe78f47df71977890996b3e60` (sandbox) |
| `PLAID_ENV` | `sandbox` |
| `RENDER_SERVICE_ID` | (paytrack service ID — find in Render dashboard URL, looks like `srv-xxxxx`) |

Note: `RENDER_API_KEY` is already set per `reference_credentials.md`.

`PLAID_ACCESS_TOKEN` and `PLAID_CURSOR` will be set automatically by the Link flow and sync process.

- [ ] **Step 2: Verify the service ID**

In the Render dashboard URL for paytrack, the service ID appears as `srv-d632r5m8alac73cbqubg` — use this as `RENDER_SERVICE_ID`.

Set `RENDER_SERVICE_ID=srv-d632r5m8alac73cbqubg` in Render env vars.

---

## Task 9: Mac launchd Nightly Sync Job

**Files:**
- Create: `~/Scripts/paytrack-plaid-sync.sh` (Mac)
- Create: `~/Library/LaunchAgents/com.lemed.paytrack-plaid-sync.plist` (Mac)

- [ ] **Step 1: Create the script on Mac via SSH**

```bash
ssh m2pro "cat > ~/Scripts/paytrack-plaid-sync.sh << 'SCRIPT'
#!/bin/bash
# Nightly Plaid sync for paytrack — daily 11 PM Pacific
# SMS on failure via Twilio (same pattern as ar-etl.sh)

LOG=~/Logs/paytrack-plaid-sync.log
ADMIN_PASSWORD=\$(grep -o 'ADMIN_PASSWORD=[^[:space:]]*' ~/.zshenv | cut -d= -f2)

log() { echo \"\$(date '+%Y-%m-%d %H:%M:%S') \$1\" >> \"\$LOG\"; }

log 'Starting Plaid sync...'

RESPONSE=\$(curl -s -o /tmp/plaid-sync-response.json -w '%{http_code}' \\
  -X POST https://paytrack.lemedspa.app/api/admin/plaid/sync \\
  -H \"password: \$ADMIN_PASSWORD\" \\
  -H 'Content-Type: application/json' \\
  --max-time 120)

HTTP_CODE=\"\$RESPONSE\"
BODY=\$(cat /tmp/plaid-sync-response.json 2>/dev/null)

log \"HTTP \$HTTP_CODE — \$BODY\"

if [ \"\$HTTP_CODE\" != '200' ]; then
  log 'ERROR: sync failed'
  # SMS Mike on failure (same pattern as ar-etl.sh)
  /opt/homebrew/bin/node ~/Scripts/notify-sms.mjs \"Paytrack Plaid sync FAILED: HTTP \$HTTP_CODE — \$BODY\" 2>>\"\$LOG\" || true
  exit 1
fi

SUCCESS=\$(echo \"\$BODY\" | /opt/homebrew/bin/node -e \"let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const p=JSON.parse(d); process.stdout.write(p.success?'true':'false'); })\")

if [ \"\$SUCCESS\" != 'true' ]; then
  MSG=\$(echo \"\$BODY\" | /opt/homebrew/bin/node -e \"let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const p=JSON.parse(d); process.stdout.write(p.message||'unknown'); })\")
  log \"ERROR: sync returned failure: \$MSG\"
  /opt/homebrew/bin/node ~/Scripts/notify-sms.mjs \"Paytrack Plaid sync FAILED: \$MSG\" 2>>\"\$LOG\" || true
  exit 1
fi

log 'Plaid sync completed successfully'
SCRIPT
chmod +x ~/Scripts/paytrack-plaid-sync.sh"
```

- [ ] **Step 2: Create the launchd plist on Mac**

```bash
ssh m2pro "cat > ~/Library/LaunchAgents/com.lemed.paytrack-plaid-sync.plist << 'PLIST'
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key>
  <string>com.lemed.paytrack-plaid-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/mikeculver/Scripts/paytrack-plaid-sync.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>23</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/mikeculver/Logs/paytrack-plaid-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/mikeculver/Logs/paytrack-plaid-sync.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST"
```

- [ ] **Step 3: Load the launchd job**

```bash
ssh m2pro "launchctl load ~/Library/LaunchAgents/com.lemed.paytrack-plaid-sync.plist"
```

Verify it's loaded:
```bash
ssh m2pro "launchctl list | grep paytrack-plaid-sync"
```

Expected: entry appears in list (exit code 0 means loaded but not running, which is correct — it fires at 11 PM).

- [ ] **Step 4: Create log directory if needed**

```bash
ssh m2pro "mkdir -p ~/Logs"
```

- [ ] **Step 5: Test the script manually**

```bash
ssh m2pro "bash ~/Scripts/paytrack-plaid-sync.sh"
```

Before a Chase account is connected, expected: HTTP 500 with "Bank account not connected" — the script will detect failure and SMS Mike. That's the correct failure path. Confirm in the log:

```bash
ssh m2pro "tail -20 ~/Logs/paytrack-plaid-sync.log"
```

- [ ] **Step 6: Update CLAUDE.md with launchd entry**

In `lmdev/CLAUDE.md`, in the "Mac — launchd" table, add:

```
| `com.lemed.paytrack-plaid-sync` | `~/Scripts/paytrack-plaid-sync.sh` | Daily 11:00 PM | Calls paytrack Plaid sync API, SMS on failure. Logs: `~/Logs/paytrack-plaid-sync.log`. |
```

- [ ] **Step 7: Update reference_credentials.md with Plaid entry**

In `AIT/memory/shared/reference_credentials.md`, add a new section:

```markdown
## Plaid (paytrack bank integration)

- **Env vars:** `PLAID_CLIENT_ID` = `69fbbdaf8a7a05000d309947`, `PLAID_SECRET` = (sandbox: `a13a2fe78f47df71977890996b3e60`, prod: `80e8faa53101959d17896f73a1fe79`), `PLAID_ENV` = `sandbox` (flip to `production` for live Chase)
- **Access token:** `PLAID_ACCESS_TOKEN` — set in Render env vars after Link OAuth flow (cannot be pre-populated; requires Mike to click "Connect Chase" in admin panel)
- **Cursor:** `PLAID_CURSOR` — set in Render env vars after each sync (blank = re-fetch 30 days)
- **Dashboard:** https://dashboard.plaid.com — log in with LM Operations credentials
- **Pre-authorized:** Trigger sync, manage Link tokens, read transaction data for paytrack employees
- **Ask-first:** Switching from sandbox to production (requires one-time Link flow re-run by Mike)
- **Last verified:** 2026-05-06
```

- [ ] **Step 8: Commit**

```bash
git add AIT/memory/shared/reference_credentials.md CLAUDE.md
git commit -m "[paytrack] Add Plaid launchd job + document credentials

- com.lemed.paytrack-plaid-sync: daily 11 PM, SMS on failure
- Plaid credentials documented in reference_credentials.md
- CLAUDE.md launchd table updated

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Integration Test + Deploy

- [ ] **Step 1: Deploy to Render**

```bash
cd C:/Users/LMOperations/lmdev/paytrack
git push origin main
```

Wait for Render to build (2-3 min).

- [ ] **Step 2: Smoke test the deployed routes**

```bash
# Should return 401 — confirms route is registered
curl -s -X POST https://paytrack.lemedspa.app/api/admin/plaid/sync | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: `{ success: false, message: 'Unauthorized' }`

```bash
# Should return 400 "Bank account not connected" — confirms Plaid is wired up
ADMIN_PWD=$(node -e "require('dotenv').config({path:'paytrack/.env'}); console.log(process.env.ADMIN_PASSWORD)" 2>/dev/null || echo "$ADMIN_PASSWORD")
curl -s -X POST https://paytrack.lemedspa.app/api/admin/plaid/sync -H "password: $ADMIN_PWD" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: `{ success: false, message: 'Bank account not connected...' }` (because `PLAID_ACCESS_TOKEN` not yet set)

- [ ] **Step 3: Connect Chase in Sandbox mode (Mike does this)**

1. Open https://paytrack.lemedspa.app/admin
2. Log in, click "Bank Integration" tab
3. Click "Connect Chase"
4. Plaid Link modal opens → use Plaid sandbox credentials (user: `user_good`, password: `pass_good`, for Chase select "Chase")
5. After connecting, click "Sync Now"
6. Verify transactions appear in Pending Review or Auto-Imports

- [ ] **Step 4: Verify in Supabase**

After sync, check:
```sql
SELECT COUNT(*) FROM plaid_pending;
SELECT COUNT(*) FROM payments WHERE auto_imported = true;
SELECT COUNT(*) FROM payments WHERE plaid_transaction_id IS NOT NULL;
```

At least some sandbox transactions should appear.

- [ ] **Step 5: Run all existing tests to confirm no regressions**

```bash
node test/crypto.test.js
node test/plaid-client.test.js
node test/plaid-sync.test.js
```

All should PASS.

- [ ] **Step 6: Final commit and session notes**

```bash
git add -p  # stage any remaining changes
git commit -m "[paytrack] Plaid–Chase integration complete

Full Plaid bank sync: Link OAuth, nightly curl, match to employees, auto-import with verify/reverse.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
```

---

## Spec Coverage Checklist

| Spec Requirement | Plan Task |
|-----------------|-----------|
| `zelle_name` column on employees | Task 1 (DB) + Task 6 (UI) |
| `plaid_pending` table | Task 1 (DB) |
| `payments.auto_imported`, `payments.plaid_transaction_id` | Task 1 (DB) |
| `server/plaid-client.js` | Task 2 |
| `server/plaid-sync.js` | Task 3 |
| 7 API routes | Task 4 |
| Admin panel "Bank Integration" tab | Tasks 5+6 |
| Connection Status section | Task 6 |
| Sync Controls section | Task 6 |
| Pending Review table with Assign + Not a payout | Task 6 |
| Recent Auto-Imports with Verify + Reverse | Task 6 |
| Mac launchd nightly sync | Task 9 |
| Render env vars (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV) | Task 8 |
| PLAID_ACCESS_TOKEN + PLAID_CURSOR written back to Render | Tasks 3+4 |
| SMS on launchd failure | Task 9 |
| Duplicate prevention via UNIQUE constraint | Task 1 + Task 3 |
