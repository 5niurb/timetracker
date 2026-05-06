# Plaid–Chase Integration Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically pull Chase bank transactions via Plaid nightly, match them to paytrack employees, and record matched transactions as payouts — supporting payroll tracking and 1099 tax reporting.

**Architecture:** Plaid SDK runs server-side in paytrack (Render). Admin panel gets a new "Bank Integration" tab for one-time Link OAuth setup, on-demand sync, pending review queue, and auto-import verification. A Mac launchd job triggers nightly sync via the paytrack API.

**Tech Stack:** `plaid-node` SDK, Supabase PostgreSQL (payments + plaid_pending tables), Express API routes, vanilla JS admin panel, Mac launchd

---

## Architecture

```
Chase Bank (Plaid)
     │
     │  one-time Link OAuth (admin panel → /api/admin/plaid/link-token → /api/admin/plaid/exchange-token)
     ▼
PLAID_ACCESS_TOKEN → Render env var
PLAID_CURSOR       → Render env var (incremental sync position)
     │
     │  nightly: launchd → POST /api/admin/plaid/sync (password header auth)
     │  on-demand: admin clicks "Sync Now"
     ▼
server/plaid-sync.js  ←→  server/plaid-client.js
     │
     ├── match transactions → employees (full name or zelle_name alias)
     ├── auto-import matched → payments table (auto_imported=true, plaid_transaction_id set)
     └── queue unmatched → plaid_pending table
     │
     ▼
Admin Panel — "Bank Integration" tab
     ├── Connect/Reconnect Chase (Plaid Link flow)
     ├── Sync Now + last sync timestamp
     ├── Pending Review queue (unmatched transactions)
     └── Recent Auto-Imports with Verify / Reverse buttons
```

---

## Database Changes

### 1. `employees` table — new column
```sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS zelle_name TEXT;
```
Optional. When set, used as the match key instead of the employee's full `name`. Admin sets this once per employee in the Team Members tab. Supports Zelle truncated names and Jodi's ACH matching.

### 2. New `plaid_pending` table
Holds unmatched transactions awaiting manual assignment.
```sql
CREATE TABLE IF NOT EXISTS plaid_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3. `payments` table — two new columns
```sql
ALTER TABLE payments ADD COLUMN IF NOT EXISTS auto_imported BOOLEAN DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plaid_transaction_id TEXT UNIQUE;
```
`plaid_transaction_id` prevents duplicate imports if sync runs twice over the same date range. `auto_imported` flags records for admin verification.

---

## New Files

| File | Purpose |
|------|---------|
| `server/plaid-client.js` | Plaid SDK wrapper — initialize client, create Link token, exchange public token, fetch transactions via `/transactions/sync` |
| `server/plaid-sync.js` | Match logic — compare Plaid transactions to employees (by `zelle_name` or full `name`), produce matched/unmatched lists, upsert to Supabase |

### `server.js` — new routes (7)

| Route | Purpose |
|-------|---------|
| `POST /api/admin/plaid/link-token` | Create Plaid Link token to initialize Link flow |
| `POST /api/admin/plaid/exchange-token` | Exchange public token for access token, store in Render env var |
| `POST /api/admin/plaid/sync` | Run transaction sync (used by launchd + Sync Now button) |
| `GET /api/admin/plaid/pending` | Return unmatched transactions from `plaid_pending` |
| `POST /api/admin/plaid/pending/:id/assign` | Assign pending transaction to an employee → inserts into `payments` |
| `POST /api/admin/plaid/payments/:id/verify` | Clear `auto_imported` flag on a payment |
| `DELETE /api/admin/plaid/payments/:id/reverse` | Delete auto-imported payment, return transaction to `plaid_pending` |

---

## Matching Logic

In `server/plaid-sync.js`:

1. Load all employees from Supabase (id, name, zelle_name)
2. Build match map: `zelle_name ?? name` → employee_id (case-insensitive, trimmed)
3. For each Plaid transaction (debit, from checking account):
   - Attempt substring match of map keys against transaction `name` / `merchant_name`
   - **Matched:** upsert into `payments` with `auto_imported=true`, `plaid_transaction_id` set, `source='plaid'`
   - **Unmatched:** upsert into `plaid_pending` (idempotent via `plaid_transaction_id` UNIQUE constraint)
4. Advance Plaid cursor and persist to `PLAID_CURSOR` env var via Render API

**Incremental sync:** Uses Plaid's `/transactions/sync` cursor — only fetches new/modified transactions since last run. First run fetches up to 30 days back.

---

## Admin Panel — "Bank Integration" Tab

Four sections in `public/admin.html` + `public/js/admin.js`:

### 1. Connection Status
- Shows "Connected: Chase ···1234 (last synced: 2026-05-05 11:02 PM)" or "Not connected"
- "Connect Chase" / "Reconnect" button triggers Plaid Link modal

### 2. Sync Controls
- "Sync Now" button → `POST /api/admin/plaid/sync`
- Shows spinner during sync, success/error toast after
- Displays count of new auto-imports and new pending items from last sync

### 3. Pending Review
Table of unmatched transactions:
- Columns: Date | Amount | Description | Assign To (employee dropdown) | Action
- "Assign" button calls `/api/admin/plaid/pending/:id/assign` with selected employee_id
- "Not a payout" button deletes from `plaid_pending` without creating a payment
- Empty state: "No unmatched transactions"

### 4. Recent Auto-Imports
Last 30 auto-imported payments (filtered by `auto_imported=true`):
- Columns: Date | Employee | Amount | Description | Status
- Status: orange "Unverified" badge with "Verify ✓" button, or green "Verified" badge
- "Reverse" button: deletes payment, re-queues to `plaid_pending`

---

## Mac launchd Job

**Script:** `~/Scripts/paytrack-plaid-sync.sh`
**plist:** `~/Library/LaunchAgents/com.lemed.paytrack-plaid-sync.plist`
**Schedule:** Daily 11:00 PM Pacific
**Command:**
```bash
curl -s -X POST https://paytrack.lemedspa.app/api/admin/plaid/sync \
  -H "password: $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  >> ~/Logs/paytrack-plaid-sync.log 2>&1
```
**On failure:** SMS to Mike (310-621-8356) via Twilio — same pattern as `ar-etl.sh`
**Logs:** `~/Logs/paytrack-plaid-sync.log`

---

## Environment Variables

| Var | Where | Purpose |
|-----|-------|---------|
| `PLAID_CLIENT_ID` | Render env var | Plaid app client ID |
| `PLAID_SECRET` | Render env var | Plaid sandbox/production secret |
| `PLAID_ENV` | Render env var | `sandbox` or `production` |
| `PLAID_ACCESS_TOKEN` | Render env var | Chase account access token (set after Link flow) |
| `PLAID_CURSOR` | Render env var | Incremental sync cursor (updated after each sync) |

`PLAID_ACCESS_TOKEN` and `PLAID_CURSOR` are written back to Render after the Link exchange and after each sync respectively, using the Render API (`RENDER_API_KEY` already in env).

---

## Error Handling

- **Plaid API errors:** Log error + return `{ success: false, error }`. SMS alert if called from launchd.
- **Duplicate transaction:** `plaid_transaction_id` UNIQUE constraint silently deduplicates — not an error.
- **No access token set:** Sync endpoint returns 400 "Bank account not connected" immediately.
- **Render API write failure (cursor update):** Log warning but don't fail the sync — next run re-processes the same transactions (deduplicated by UNIQUE constraint).

---

## Out of Scope

- General expense classification or accounting categorization (future)
- Multiple bank accounts
- Non-Chase institutions
- Plaid webhooks (polling via launchd is sufficient for nightly cadence)
- Plaid sandbox test UI (developer workflow only — not shipped to production panel)
