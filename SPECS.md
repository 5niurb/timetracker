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

## Database Schema

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `employees` | Staff profiles | name, pin, email, hourly_wage, commission_rate, pay_type |
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
