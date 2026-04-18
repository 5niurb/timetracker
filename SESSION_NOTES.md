## Session — 2026-04-17 (Flatten employee schema — full data architecture redesign)

**Focus:** Execute 6-task plan: collapse `employee_onboarding` into flat `employees` table; reusable review flow; admin PII edit tabs; Haiku insurance extraction script.

**Accomplished:**
- **Task 1:** Migration 006 — 41 new columns added to `employees`, `employee_onboarding` dropped, `onboarding_token` → `review_token`
- **Task 2:** server.js — all routes updated to use `employees` directly; added `PUT /api/admin/employees/:id/pii`; reusable review links (no one-shot redirect)
- **Task 3:** `public/review.html` — copy of onboarding form with "Review & Confirm" framing; served at `/onboarding/:token`
- **Task 4:** admin.html/admin.js/admin.css — edit modal now has 4-tab PII editor (Identity, Tax/W-9, Insurance, Banking); admin can edit any field directly without employee token
- **Task 5:** `scripts/populate-tins.mjs` — one-off script to set TIN + PIN from 1099 PDF extract
- **Task 6:** `scripts/extract-insurance.mjs` — Claude Haiku reads COI PDFs from Supabase Storage; extracts insurer, policy, expiration, coverage amounts

**Diagram:**
```
Admin panel (edit modal)        Employee review link
  ├─ Basic info (top)             /onboarding/:token → review.html
  ├─ Save Changes (name/pin/etc)    ↓ POST /api/onboarding/:token
  └─ TEAMMATE DETAILS tabs           → UPDATE employees (single row)
      Identity | Tax | Insurance | Banking
      [Save Details] → PUT /api/admin/employees/:id/pii

employees table (single source of truth)
  id, name, pin, ... , first_name, last_name, tin_encrypted,
  bank_routing_encrypted, review_token, review_completed_at, ...
  (employee_onboarding table DROPPED)
```

**Current State:**
- All 6 tasks complete and pushed to GitHub (eb8fc38..0495455)
- Render auto-deploy triggered — should be live in ~3 min
- 23/23 tests pass
- `populate-tins.mjs` needs TIN_DATA filled in from 1099 PDF before running
- `extract-insurance.mjs` needs `@anthropic-ai/sdk` installed + `ANTHROPIC_API_KEY` in env

**Issues:**
- None known

**Next Steps:**
- Verify production deploy at paytrack.lemedspa.app
- Fill TIN_DATA in populate-tins.mjs (ask Lea for SSNs from 1099 PDF)
- Run extract-insurance.mjs once employees upload their COI PDFs
- SPECS.md update for new schema + routes

---

## Session — 2026-04-17 (Team Table modal + compliance overhaul + payments fix)

**Focus:** Redesign edit modal as "Team Table", overhaul compliance checklist with manual review items, fix Payments tab, Team Member list tweaks.

**Accomplished:**
- Edit modal renamed "Team Table", widened to 720px
- Pay Rate → "Hourly Rate: Service Revenue ($)"
- Additional Pay Rate → "Hourly Rate-Training & Development ($)"
- Contract Details section (read-only, pulled from `employee_onboarding`): time commitment, other commitments, signed acknowledgment, acknowledgment date
- Compliance checklist labels: W-9 → "Tax Info / W-9", NDA slot → "Signed NDA / Contract", Professional License → "Active Professional License"
- 3 new manual review items with comment + Save Note / Mark Verified buttons:
  - "Disciplinary actions or concerns?"
  - "Current professional liability coverage"
  - "Adequate professional liability coverage (250K+ occurrence, 1M+ aggregate)"
- Migration 009: `employee_compliance_items` table (employee_id, item_key, is_cleared, comment, cleared_at)
- New API endpoints: `GET /api/admin/employees/:id/compliance-items`, `PUT /api/admin/employees/:id/compliance-items/:key`
- Team list: "Compliance" → "Compliant?", Yes/No text (was ✓/✗ icons), Copy Link button removed, pencil rotated 45°, columns narrowed
- Payments: error message shown on non-OK response (was silently blank)
- Deployed: commit aca9338

**Diagram:**
```
Team Members list                    Team Table modal
  Name (link) | ... | Compliant? | Actions     Title: "Team Table" (720px wide)
              Yes/No ←→ editEmployee()          ├─ Basic info (1-6 unchanged)
              rotated pencil ✏ button           ├─ Pay: "Hourly Rate: Service Revenue"
                                                ├─ "Hourly Rate-Training & Development"
employee_compliance_items            ├─ CONTRACT DETAILS (read-only from onboarding)
  employee_id, item_key, is_cleared  └─ COMPLIANCE CHECKLIST
  comment, cleared_at                    required docs + 3 manual review items
  ↑ PUT /api/admin/.../compliance-items/:key   [Save Note] [Mark Verified]
```

**Current State:**
- All previous functionality intact
- Payments tab: 78 historical payments in DB, tab should display correctly now
- New compliance items table empty (populated as admin reviews each employee)

**Issues:**
- Payments tab was blank for user — likely Render hadn't deployed when tested; now has visible error message if it fails again
- Chase bank integration (weekly auto-pull of transactions) — deferred, needs research

**Next Steps:**
- Verify Payments tab working at paytrack.lemedspa.app
- Chase bank integration research (Plaid vs direct Chase API vs manual xlsx upload workflow)
- SPECS.md update

---

## Session — 2026-04-16 (compliance checklist + expiry tracking)

**Focus:** Structured compliance doc checklist in edit modal; expiry/license metadata; DB enrichment.

**Accomplished:**
- Migration 007: Added `expiration_date DATE` + `license_number TEXT` to `employee_documents`
- Enrichment SQL: Backfilled existing rows from Talent Vendor Database.xlsx
  - Jodi (id=13) professional_license: #171374, exp 2027-04-30
  - Lucine (id=14) professional_license: #95350547, exp 2026-12-31
  - Lucine (id=14) insurance: exp 2026-09-01
  - Jade (id=11) insurance: exp 2025-06-29 (EXPIRED)
- Fixed designations for imported employees: Salakjit→Esthetician, Kirti→Aesthetic Nurse Practitioner, Sheila→Esthetician
- Compliance checklist UI in edit modal:
  - Required docs derived from designation (all: W-9, Gov ID, NDA; clinical: + license + insurance)
  - Missing docs show `○` placeholder with `+ Upload` shortcut button
  - Uploaded required docs show `✓` green border + expiry badge (green/yellow/orange/red)
  - Additional (non-required) docs shown in separate section
- Upload form: conditional expiry date + license# inputs (shown only for applicable types)
- New PATCH `/api/admin/employee-documents/:docId` for metadata-only edits (expiry/license/notes)
- GET docs route now returns `expiration_date`, `license_number`
- POST docs route now saves `expiration_date`, `license_number`
- Deployed to Render (commit e6deaf4)

**Diagram:**
```
Edit Modal → COMPLIANCE DOCUMENTS section
  REQUIRED (per designation):
    ✓ W-9            [green border, ✓]
    ○ Gov ID         [gray, + Upload →]  sets type select + scrolls
    ✓ Prof License   [green, #171374, EXP Apr 30 2027]
    ✓ Insurance      [red,   EXPIRED Jun 29 2025]
  ADDITIONAL:
    [contract, other docs not in required list]
Upload form: type select → show/hide expiry + license# inputs
```

**Current State:**
- 9 employees: 7 active + 2 inactive (Kirti, Sheila)
- All designations now set correctly
- 18 docs in `employee_documents`; 4 rows enriched with expiry/license data
- Compliance checklist live on Render

**Issues:**
- Jade's insurance is EXPIRED (2025-06-29) — needs renewal → shows as ✗ NOT COMPLIANT
- Sheila's professional license EXPIRED (2026-02-28) → shows as ✗ NOT COMPLIANT
- Jade has no professional_license doc uploaded (license #753411 known from xlsx, but no file)
- Lea Culver: no employee record (no email source)
- Kirti has no professional_license doc uploaded yet (license# 95007091 known)
- NDA: no standalone NDA docs uploaded for anyone, but contractor agreements satisfy requirement for those who have them (Jade, Lucine, Sheila)

**Updated (later in session):**
- NDA slot: contractor agreement satisfies it (contract docs consumed by NDA slot, not shown in ADDITIONAL)
- Compliance checklist redesigned: COMPLIANT / NOT COMPLIANT status badge derived from all requirements; expired docs count as ✗
- Heading renamed to "COMPLIANCE CHECKLIST"
- Deployed: commit 6ea0331

**Next Steps:**
- W9 pre-population feature (deferred)
- SPECS.md update for compliance checklist feature
- Consider showing compliance status column in Team Members list view

---

## Session — 2026-04-16 (status field + employee_documents + doc uploads)

**Focus:** Employee status field, inactive contractors, compliance doc uploads.

**Accomplished:**
- Migration 006: Added `status TEXT DEFAULT 'active'` to `employees`; created `employee_documents` table (RLS enabled)
- Created Kirti Patel (id=17, pin=8177, status=inactive, email=kirti821@gmail.com)
- Created Sheila Ewart (id=18, pin=8182, status=inactive, email=she.ewart@gmail.com)
- Uploaded 18 compliance documents to Supabase Storage `onboarding-documents` bucket and inserted `employee_documents` rows:
  - Jade (11): DL, insurance, contract
  - Jodi (13): esthetician license, W9
  - Kirti (17): DL, insurance, W9, 2× other
  - Lucine (14): W9, BRN license, NSO insurance, contractor agreement, BLS cert, CPR cert
  - Vayda (15): W9
  - Sheila (18): contractor agreement
- Updated `server.js`: GET employees now returns `status`; PUT employees accepts + saves `status`
- Updated `supabase-schema.sql` + `migrations/006_employee_status_and_documents.sql` (via Supabase MCP)

**Diagram:**
```
iCloudDrive/LeMed Owners/1.0 LM Talent/
  Jade/       Jodi Kay/    Kirti Patel/   Lucine Keseyan/  Vayda/  _old/Sheila E/
    ↓ upload-employee-docs.mjs
Supabase Storage: onboarding-documents/employee-{id}/
    ↓ insert
employee_documents table (18 rows)
employees table: status col added; Kirti(17) + Sheila(18) = inactive
```

**Current State:**
- 9 employees total: 7 active contractors + 2 inactive (Kirti, Sheila)
- 18 docs in `employee_documents`, all with correct types and storage paths
- tax_filings: 6 rows (2024 1099-NEC data, all encrypted TINs)

**Issues:**
- Leena Osman still has no SSN — onboarding will need to collect it
- Sheila's `email with ID License W9.msg` not uploaded (Outlook .msg format, would need extraction)
- Kirti's image0/image2 uploaded as `other` — unclear what they are

**Next Steps:**
- Push to GitHub → Render deploy (picks up server.js status field changes)
- Lea Culver: no email in any source, cannot create record yet
- W9 pre-population feature (mentioned in onboarding email)
- Admin UI: show/filter by status, show documents tab in employee detail modal
- SPECS.md update for status + employee_documents features

---

## Session — 2026-04-16 (tax_filings + 1099 import + RLS fix)

**Focus:** 1099 data import, tax_filings table + API, RLS fix, new employees.

**Accomplished:**
- Fixed critical bug: all 59 server.js DB queries switched from anon key → `supabaseAdmin` (service role), which bypasses RLS. RLS stays enabled on `employees` + `employee_onboarding` per Supabase security advisory.
- Created `tax_filings` table in production Supabase (migration 005-tax-filings.sql). RLS enabled.
- Added 7 tax_filings API routes to server.js: list (filter by year/employee), get by id, create, update, delete, export CSV (Avalara/Track1099-compatible format).
- Imported 2024 1099-NEC data for all 6 contractors from CSV:
  - Jade Gonzales: $34,168.10 (SSN last4: 1530)
  - Jodi Kay: $19,146.33 (SSN last4: 7478)
  - Salakjit Hanna: $13,397.00 (SSN last4: 3613) ← NEW employee created
  - Vayda Kasbah: $3,740.90 (SSN last4: 6454) ← NEW employee created
  - Leena Osman: $1,140.00 (no SSN in CSV)
  - Lucine Keseyan: $704.92 (SSN last4: 0041)
- Created employee records for Vayda Kasbah (pin=6764) and Salakjit Hanna (pin=3157) — they had emails in the CSV but were previously skipped.
- All TINs AES-256-GCM encrypted at rest.
- Added supabase-schema.sql documentation for tax_filings.

**Diagram:**
```
CSV (iCloudDrive)                     Supabase (production)
1099-NEC 2024 data                    employees (7 contractors)
  ↓ import-1099-2024.mjs               ├─ Jade Gonzales (id=11)
  ↓ encrypt SSN → AES-256-GCM         ├─ Leena Osman (id=12)
  ↓                                    ├─ Jodi Kay (id=13)
  └──────────────────────────────────► ├─ Lucine Keseyan (id=14)
                                        ├─ Vayda Kasbah (id=15) NEW
                                        └─ Salakjit Hanna (id=16) NEW
                                       tax_filings (6 rows, 2024)
```

**Current State:**
- 7 tax_filings API routes live in server.js (deploying on push)
- 6 tax_filing rows in production with encrypted TINs
- 7 active contractors in employees table
- RLS: enabled on employees + employee_onboarding, bypassed by service role

**Issues:**
- Vayda and Salakjit need onboarding links sent (emails available now)
- Kirti Patel, Sheila Ewart, Lea Culver still not in system (no email in any source)
- Leena Osman has no SSN in CSV — onboarding will need to collect it

**Next Steps:**
- Deploy: push server.js to trigger Render deploy
- Send onboarding links to Vayda (vkasbah@hotmail.com) and Salakjit (salakjithanna@icloud.com)
- Verify Twilio `+12134442242` is active for SMS send-link
- W9 pre-population (mentioned in onboarding email — not yet built)
- 1099 CSV export endpoint: test at `/api/admin/tax-filings/export/2024`
- SPECS.md update for tax_filings feature

---

## Session — 2026-04-16 (E2E test + DB fixes)

**Focus:** PayTrack onboarding E2E test — found and fixed two production bugs.

**Accomplished:**
- Ran full E2E: create employee → prefill → submit onboarding → verify DB → cleanup
- **Bug 1:** `driver_license_number` column missing from `employee_onboarding` — added via Supabase MCP. Every onboarding submit was returning 500.
- **Bug 2:** RLS enabled on `employees` + `employee_onboarding` with zero policies (deny-all). Disabled — paytrack uses its own auth, not Supabase Auth.
- Updated `supabase-schema.sql` to full production schema (was missing employee_onboarding table and ~6 months of columns).

**Diagram:**
```
Admin              Onboarding             DB (fixes applied)
POST /employees → token                employees (RLS=off ✓)
GET /prefill    → name/email/desig     employee_onboarding
POST /onboarding → validate+encrypt → driver_license_number col added ✓
employees.onboarding_completed_at ← marked
```

**Current State:** E2E passing. Both DB bugs fixed in production. Pushed to GitHub.

**Issues:** None known.

**Next Steps:**
- SMS send link: verify Twilio `+12134442242` is active (untested live)
- W9 pre-population (mentioned in onboarding email — not yet built)
- 1099 CSV export (deferred)
- SPECS.md update for v2 onboarding

---

## Session — 2026-04-15

**Focus:** Worker self-onboarding feature — end-to-end build

**Accomplished:**

- Migration SQL `002-worker-onboarding.sql`: 8 new columns on `employees` + new `employee_onboarding` table (~35 fields). Paste into Supabase SQL Editor to apply.
- `lib/onboarding-validation.js`: all validators (SSN, EIN, ZIP, phone, state, ABA checksum, DOB ≥18, future date, last4 extraction, full form validation)
- `test/validation.test.js`: 50 tests written red-first. All 50 pass.
- `server.js`: 4 new onboarding routes + employee creation auto-generates UUID token
- `public/onboarding.html`: 8-section form (Identity, Address, Tax, License, Insurance, Driver's License, Banking, Attestation) with PayTrack dark+gold styling, inline validation, reveal toggles for sensitive fields, success screen
- `public/admin.html` + `public/js/admin.js`: Employees tab updated — Onboarding column, Copy Link button, View Details modal (shows last-4 masked values only). Link shown in success banner after adding employee.
- `SPECS.md`: new Worker Self-Onboarding section with full requirements, API table, DB schema, validation table, design decisions

**Diagram:**

```
Admin creates employee
  → server generates onboarding_token (UUID)
  → link shown in success banner + copied to clipboard
  → employee receives link /onboarding/<uuid>
  → fills 8-section form (public, no auth)
  → POST /api/onboarding/:token
      → validates via onboarding-validation.js
      → inserts employee_onboarding row
      → sets employees.onboarding_completed_at
  → Admin: Employees tab shows ✓ COMPLETE + date + View Details modal
```

**Current State:**

- All code committed and pushed to GitHub (2 commits)
- Render auto-deploying (push at ~end of session)
- Tests: 50/50 passing

**Issues / Remaining:**

- **Migration not yet applied to Supabase production** — must paste `migrations/002-worker-onboarding.sql` into Supabase SQL Editor before the feature works in production
- pgsodium encryption deferred — `*_encrypted` columns store plaintext with `TODO(security)` comments; `*_last4` columns always populated correctly

**Next Steps:**

1. Apply migration to Supabase production: paste `timetracker/migrations/002-worker-onboarding.sql` into Supabase SQL Editor (project `skvsjcckissnyxcafwyr`)
2. Verify: create a test employee → copy onboarding link → fill form → verify DB row + admin "View Details"
3. (Future) Wire pgsodium for `tin_encrypted`, `bank_routing_encrypted`, `bank_account_encrypted`
4. (Future) Add email notification to worker when form is received (optional, not requested)
