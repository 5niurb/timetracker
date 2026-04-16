# SPECS.md — LM PayTrack (Timetracker)

> **Auto-maintained by Claude.** Updated after each feature, design change, or component implementation.
> Detailed enough to rebuild the entire app from scratch.

---

## Architecture Overview

| Layer | Tech | Deployment |
|-------|------|-----------|
| Frontend | Vanilla HTML/CSS/JS (PWA) | Render.com (served by Express) |
| Backend | Express.js (Node.js) | Render.com (auto-deploy on push) |
| Database | Supabase PostgreSQL | Supabase hosted |
| Email | Resend API | Transactional invoices |
| Auth | PIN-based (employees), Password (admin) | — |

---

## Employee App (`/`)

### Login

**Purpose:** 4-digit PIN entry for employee authentication.

**Acceptance Criteria:**
- [ ] 4-digit PIN validated against `employees.pin`
- [ ] Invalid PIN shows error
- [ ] Successful login loads main app with employee context
- [ ] Employee can change PIN from within app

---

### Pay Entry Tab

**Purpose:** Daily time and earnings logging.

**Components:**
- Date picker (scrollable wheel, limited to past dates only)
- Start/end time inputs with automatic hour calculation
- Break time input (minutes, deducted from total)
- Service entries: patient name, procedure, amount earned, tip amount
- Sales entries: product name, sale amount, commission (percentage or flat toggle)
- Duplicate date detection with override modal

**Acceptance Criteria:**
- [ ] Date wheel only allows past dates
- [ ] Hours auto-calculate from start/end times minus breaks
- [ ] Service entries capture patient, procedure, earnings, tips
- [ ] Sales entries toggle between percentage and flat commission
- [ ] Duplicate date detected → override confirmation modal
- [ ] Save persists all data to Supabase

---

### Pay Review Tab

**Purpose:** Summary of current pay period with invoice generation.

**Components:**
- Pay period navigation (arrows: previous/next, label shows 1st-15th or 16th-end)
- Summary stats cards: Hours, Wages, Commissions, Tips, Total Payable
- Daily breakdown table (expandable, delete per entry)
- Generate Invoice button → Preview modal → Confirm & Submit

**Pay Period Logic:**
- Period 1: 1st–15th of each month
- Period 2: 16th–last day of month
- Navigation arrows move between periods

**Invoice Flow:**
1. Click "Generate Invoice"
2. Preview modal shows daily breakdown + totals
3. Confirm → Email sent via Resend to:
   - TO: lea@lemedspa.com, ops@lemedspa.com
   - CC: Employee email
4. Invoice record saved to `invoices` table
5. Cannot submit same period twice

**Acceptance Criteria:**
- [ ] Period navigation shows correct date ranges
- [ ] Summary stats match individual entries
- [ ] Daily breakdown accurate (hours, wages, commissions, tips)
- [ ] Delete entry removes from database + updates totals
- [ ] Invoice preview shows all line items
- [ ] Email sent on submit (HTML formatted)
- [ ] Double-submit prevented

---

## Admin Panel (`/admin`)

### Login

- Admin password verification (single shared password)
- Not PIN-based (separate from employee auth)

---

### Review Entries Tab

**Purpose:** View and manage all employee time entries by pay period.

**Components:**
- Pay period navigation (arrows)
- Employee filter dropdown
- Daily entries table with details modal
- Delete individual entries

**Acceptance Criteria:**
- [ ] Navigate pay periods with arrows
- [ ] Filter by employee or show all
- [ ] Click entry → details modal (earnings breakdown)
- [ ] Delete entries with confirmation
- [ ] Current/previous/future period labels

---

### Employees Tab

**Purpose:** Staff management — add, edit, delete employees.

**Components:**
- Employee list
- Add form: name, PIN, email, hourly wage, pay type checkboxes
- Edit/delete actions

**Pay Types (checkbox combinations):**

| Pay Type | Hourly | Service Commissions | Sales Commissions |
|----------|--------|--------------------|--------------------|
| `hourly` | ✓ | | |
| `commission_services` | | ✓ | |
| `commission_sales` | | | ✓ |
| `hourly_services` | ✓ | ✓ | |
| `hourly_sales` | ✓ | | ✓ |
| `hourly_all` | ✓ | ✓ | ✓ |

**Acceptance Criteria:**
- [ ] Add employee with all fields
- [ ] PIN must be unique 4-digit
- [ ] Pay type checkboxes map to correct database value
- [ ] Edit updates all fields
- [ ] Delete with confirmation (prevents accidental removal)

---

### Reports Tab

**Purpose:** Earnings analytics across employees and date ranges.

**Components:**
- Date range picker (start/end)
- Grand total stats cards
- Per-employee breakdown: hours, wages, commissions, tips, tips owed

**Acceptance Criteria:**
- [ ] Date range filters data correctly
- [ ] Grand totals match sum of employee breakdowns
- [ ] Tips owed = total tips - cash tips already received
- [ ] Per-employee rows show all earning components

---

## Worker Self-Onboarding (`/onboarding/:token`)

### Overview

Token-gated public form for workers to submit their own onboarding information. Replaces manual data collection. Admin generates a unique per-employee link; worker fills in and submits the form; admin reviews via the Employees tab.

### User Flows

**Admin flow:**
1. Creates employee via Employees tab → server auto-generates `onboarding_token` (UUID v4)
2. Onboarding link displayed in success banner after adding employee
3. Employees tab shows per-employee status: Pending (token exists, not submitted) / Complete (with date + "View Details" button) / — (no token)
4. Admin can view submitted data via "View Details" → modal with all fields (sensitive fields show last 4 only)

**Worker flow:**
1. Receives link `https://paytrack.lemedspa.app/onboarding/<uuid>`
2. 8-section form rendered with dark + gold PayTrack styling
3. Fills out all sections (see below)
4. Submits → success screen replaces form (non-reversible, no back button)
5. Already-submitted tokens show graceful "already received" message

### Form Sections

1. **Identity** — First name (required), last name (required), date of birth (required, ≥18), home phone, work phone
2. **Address** — Street (required), city (required), state (required, 2-char US allowlist), ZIP (required, 5 or 9 digits)
3. **Tax (W-9)** — TIN type (SSN/EIN), TIN number, W-9 tax classification, W-9 signature date
4. **License** — License number, state, expiration (must be future if provided)
5. **Insurance** — Company, policy number, expiration (must be future if provided)
6. **Driver's License** — Number, state, expiry (must be future if provided)
7. **Banking** — Bank name (required), account owner (required), account type (required), payment method (direct_deposit/check/zelle). Direct deposit: routing + account number required. Zelle: contact required.
8. **Attestation** — IC agreement version display, checkbox certification (required), typed signature (required), date (required)

### Sensitive Field Handling

- SSN/EIN: `type="password"` with 👁/🙈 reveal toggle. Shown as `***-**-XXXX` after blur.
- Routing/account numbers: Same `type="password"` treatment.
- Server never logs raw values. Database stores `*_encrypted` column (plaintext with `TODO(security): add pgsodium encryption`) + `*_last4` masked value always stored.
- Admin modal shows only `*_last4` values (e.g., `*****6789`).

### Validation (client + server)

| Field | Rule |
|-------|------|
| SSN | `/^\d{3}-\d{2}-\d{4}$/` |
| EIN | `/^\d{2}-\d{7}$/` |
| ZIP | 5 digits or 9 digits (with or without dash) |
| Phone | ≥10 digits when stripped of formatting, ≤15 |
| State | 2-char uppercase allowlist (50 states + DC) |
| Bank routing | 9 digits + ABA checksum: `(3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9)) % 10 === 0` |
| Bank account | 4–17 digits |
| Date of birth | Past date, worker must be ≥18 years old |
| License/insurance expiration | Must be strictly future if provided |
| Attestation | Checkbox required, typed signature required, date required |

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/onboarding/:token` | None (token validates) | Render onboarding form |
| POST | `/api/onboarding/:token` | None (token validates) | Submit onboarding data |
| GET | `/api/admin/employees/:id/onboarding` | Admin password header | Fetch submitted data (masked) |
| POST | `/api/admin/employees/:id/onboarding-token` | Admin password header | Regenerate token |

### Database Changes (migration `002-worker-onboarding.sql`)

**`employees` table — 8 new columns:**

| Column | Type | Purpose |
|--------|------|---------|
| `phone` | TEXT | Primary phone |
| `designation` | TEXT | Job title/role |
| `contractor_type` | TEXT | Classification (W-2/1099) |
| `start_date` | DATE | Employment start |
| `ic_agreement_signed` | BOOLEAN | IC agreement accepted |
| `ic_agreement_signed_at` | TIMESTAMPTZ | When signed |
| `onboarding_token` | TEXT UNIQUE | UUID for form link |
| `onboarding_completed_at` | TIMESTAMPTZ | When form was submitted |

**New `employee_onboarding` table (~35 columns):** Full form submission, one row per employee. Identity, address, tax, license, insurance, banking fields. `tin_encrypted`, `bank_routing_encrypted`, `bank_account_encrypted` stored with TODO(security) comments. `*_last4` columns always populated. `submitted_at`, `ip_address`, `ic_agreement_version` for audit trail.

### Validation Library (`lib/onboarding-validation.js`)

Shared module used by both server.js and tests. Exports: `validateSSN`, `validateEIN`, `validateZip`, `validatePhone`, `validateState`, `validateBankRouting`, `validateBankAccount`, `validateDOB`, `validateFutureDate`, `extractLast4SSN`, `extractLast4Routing`, `extractLast4Account`, `validateOnboarding`.

### Tests (`test/validation.test.js`)

50 tests — written red-first, confirmed failing before implementation. Covers all validators + full form validation.

### Design Decisions

- Token security: UUID v4 via `crypto.randomUUID()` (Node built-in, no dependency)
- Encryption deferred: plaintext + `TODO(security): add pgsodium` comments rather than wiring pgsodium (non-trivial setup). Always store last4 masked values.
- No Resend email notifications (explicitly out of scope)
- No 1099 export (out of scope)
- Never store plaintext SSN/EIN in plain database columns — only in `*_encrypted` columns

---

## Database Schema

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `employees` | Staff profiles | name, pin, email, hourly_wage, commission_rate, pay_type, onboarding_token, onboarding_completed_at |
| `employee_onboarding` | Worker onboarding submissions | employee_id, personal info, address, tax (W-9), license, banking, attestation |
| `time_entries` | Daily hours | employee_id, date, start_time, end_time, break_minutes, hours |
| `client_entries` | Service work | time_entry_id, client_name, procedure_name, amount_earned, tip_amount, tip_received_cash |
| `product_sales` | Sales commissions | time_entry_id, product_name, sale_amount, commission_amount |
| `invoices` | Submitted summaries | employee_id, pay_period_start/end, totals, submitted_at, email_sent |

---

## Earning Calculation Logic

```
Total Hours    = sum(time_entries.hours) for period
Total Wages    = Total Hours × employee.hourly_wage
Total Comms    = sum(client_entries.amount_earned) for period
Total Tips     = sum(client_entries.tip_amount) for period
Product Comms  = sum(product_sales.commission_amount) for period
Cash Tips Recv = sum(client_entries.tip_received_cash) for period
Total Payable  = Wages + Comms + Tips + Product Comms - Cash Tips Recv
```

Components included depend on employee's `pay_type` setting.

---

## Technical Notes

- **Timezone:** All date logic uses Los Angeles time (America/Los_Angeles)
- **Keep-alive:** Pings every 14 minutes to prevent Render free tier spin-down
- **PWA:** Service worker registered for offline capability
- **Migration history:** SQLite → Supabase PostgreSQL (completed)
- **Design:** Dark + gold luxury theme matching lemedspa-website

---

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-08 | PIN-based employee auth | Simple, fast login for spa staff (no email/password friction) |
| 2025-08 | Single admin password | Small team, shared admin access sufficient |
| 2025-08 | Semi-monthly pay periods (1-15, 16-end) | Matches California semi-monthly pay requirements |
| 2025-10 | Migrated SQLite → Supabase | Cloud database accessible from any device |
| 2025-11 | Resend for invoice emails | Same provider as lm-app, simple API |
| 2026-01 | Dark + gold theme | Consistent brand across all LM properties |
| 2026-01 | Commission type toggle (% vs flat) | Accommodates different compensation structures |
| 2026-02 | Tips owed tracking | Separates cash tips already paid from tips still owed |
| 2026-04 | Worker self-onboarding via token link | Replaces manual data collection; UUID token is single-use per employee |
| 2026-04 | Plaintext + TODO(security) for sensitive fields | pgsodium encryption deferred; last4 masks always stored; encryption TODO visible |
| 2026-04 | Admin password stored in sessionStorage | Needed to authenticate `/api/admin/employees/:id/onboarding` from the browser |
