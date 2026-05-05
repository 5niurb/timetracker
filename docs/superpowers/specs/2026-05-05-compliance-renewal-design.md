# Compliance Document Renewal Workflow — Design Spec

**Date:** 2026-05-05  
**Project:** paytrack (LM PayTrack)  
**Status:** Approved — ready for implementation planning

---

## Overview

Automated end-to-end workflow for collecting and verifying compliance documents from LeMed Spa workers. Covers three document types: COI insurance (primary), professional license renewal reminders, and W9/contract e-sign collection (onboarding only).

The system assumes the worker has already renewed their insurance/license and simply needs to provide a copy. Tone is warm and frictionless — not accusatory.

---

## Scope

| Document Type | Trigger | Worker Action | Admin Action |
|---|---|---|---|
| **COI (Insurance)** | 30 days before expiry, or missing | Forward email or upload file | 15-second confirm page |
| **Professional License** | 30 days before expiry | Go renew at BreEZe (system provides links) | None — auto-confirmed on lookup |
| **W9 / Contract** | Onboarding (one-time), or manual admin trigger for missing docs | E-sign via Docuseal | None — Docuseal handles completion |

Contracts do not expire — W9/contract collection is onboarding-only with no renewal cycle.

---

## Architecture — Approach A (selected)

```
Nightly scan (launchd ~11pm)
  │
  ├─ COI expiring/missing → Step 1 email+SMS → tokenized link OR coi@lemedspa.com
  │     │
  │     ├─ Email forward path: Cloudflare Email Worker → extract PDF → paytrack API
  │     └─ Upload path: worker opens link → uploads file → paytrack API
  │           │
  │           └─ Claude Haiku extraction → Step 2 email+SMS (confirm link)
  │                 │
  │                 └─ Worker confirms → Mike's review queue
  │                       │
  │                       └─ Mike approves → record updated
  │
  ├─ License expiring → reminder email+SMS → BreEZe renewal links
  │     │
  │     └─ Nightly BreEZe lookup → auto-confirm when renewed
  │
  └─ Missing W9/Contract → admin manual trigger → Docuseal e-sign sent
        │
        └─ Docuseal webhook → record updated on completion
```

---

## Section 1 — COI Insurance Workflow

### Step 1: Initial Reminder

**Trigger:** Nightly scan finds COI expiring within 30 days OR no current COI on file.

**Channels:** Email (Resend) + SMS (Twilio). Both sent simultaneously.

**Content:** Warm tone — assumes the certificate has been renewed, we just need a copy. Two paths offered:
1. **Hero path:** Forward the broker email to `coi@lemedspa.com`
2. **Fallback:** Tokenized upload link (`paytrack.lemedspa.app/compliance/<token>`)

**Token spec:**
- UUID stored in `compliance_requests` table
- `type: 'upload'`, `document_type: 'coi'`
- Expires 7 days from issue
- If expired: link shows "this link has expired" + contact info

**Reminder cadence:** Day 0 (30 days before expiry) → Day 7 → Day 14 → Day 21 → Day 28 (expiry). Stop reminders once document received.

### Email Ingestion (coi@lemedspa.com)

**Implementation:** Cloudflare Email Worker on `coi@lemedspa.com`.

**Flow:**
1. Worker receives forwarded broker email → forwards to `coi@lemedspa.com`
2. Cloudflare Email Worker intercepts
3. Extracts PDF attachment
4. Matches sender email to employee record in Supabase
5. Uploads PDF to Supabase Storage (`onboarding-documents` bucket)
6. POSTs to `POST /api/compliance/coi-received` with `{ employee_id, storage_path }`
7. If sender email unrecognized: reply with "we couldn't match your email — use your upload link" and save for manual review

### AI Extraction

**Implementation:** Reuses existing `paytrack/scripts/extract-insurance.mjs` (Claude Haiku via Anthropic API).

**Extracted fields:**
- `insurer_name`
- `policy_number`
- `expiration_date`
- `per_occurrence`
- `aggregate`

**Storage:** Extracted data written to `compliance_documents` table alongside storage path.

### Step 2: Worker Confirmation

**Trigger:** Fires within minutes of document received + extraction complete.

**Channel:** Fresh email + SMS (separate from Step 1 — does not assume worker has the upload link open).

**Subject line:** "Got your insurance certificate ✓ — takes 30 sec to confirm"

**Link:** Goes directly to confirm page (`/compliance/confirm/<token>`). No upload step — document already received.

**Confirm page shows:**
- Worker's name + greeting
- Thumbnail of uploaded document (tap to view full PDF)
- Pre-filled editable fields (insurer, policy #, expiry date, per-occurrence, aggregate)
- Checkbox: "These details match my updated certificate"
- "Looks good ✓" button

**Worker edits:** Any field the worker changes is flagged in the admin review. Original AI value preserved alongside worker-corrected value.

### Admin Review

**Access:** Tab in paytrack admin panel — "Compliance Review" queue.

**Page layout (15-second flow):**
- Left: rendered COI document preview (HTML/CSS facsimile from extracted data, or embedded PDF thumbnail) + "Open full PDF ↗" link
- Right top: extracted fields in green-bordered rows
- Right middle: yellow callout if worker made edits (shows what changed, original vs corrected)
- Right bottom: three action buttons
  - **"Approve & Update Record"** (primary, green) — updates compliance record, sets expiry date, fires "All set!" email to worker
  - **"Edit Fields"** — inline edit before approving
  - **"Request New Doc"** — marks as rejected, sends new Step 1 notification

**After approval:** Record updates instantly. Item removed from queue. Worker receives brief confirmation email.

---

## Section 2 — Professional License Workflow

### Reminder Flow

**Trigger:** Nightly scan finds license expiring within 30 days.

**Channel:** Email + SMS.

**Content:** Informs worker their license renewal is coming up. Provides direct links to renew:
- **BreEZe portal:** `https://breeze.ca.gov` (RN, NP, PA, MD, Esthetician)
- License type + number pre-filled in message for easy lookup

**Tone:** Helpful — "here's the link and your license number so you can renew in one click."

**No upload required.** Worker does not send a document. System confirms renewal automatically.

### Auto-Verification

**Implementation:** Nightly BreEZe lookup using Firecrawl/Playwright.

**Input:** License type + license number stored in employee record (`professional_license_number`, `professional_license_type` fields).

**Logic:**
- If BreEZe shows updated expiry date → mark license as renewed, update expiry in DB, stop reminders
- If BreEZe shows same expiry → continue reminders
- If BreEZe lookup fails → log error, continue reminders, alert Mike if >3 consecutive failures

**No admin review required for license renewals.** System auto-confirms.

---

## Section 3 — W9 / Contract (E-Sign via Docuseal)

### Docuseal Setup

**Platform:** Docuseal (open-source, self-hosted). NAS Docker container.
- **API:** REST + webhooks
- **Cost:** Free forever (self-hosted)
- **Templates:** W9 and Independent Contractor Agreement pre-loaded

### Onboarding Flow (standard)

W9 and Contract sent automatically as part of the existing worker onboarding flow when admin adds a new team member. No additional trigger needed.

**Flow:**
1. Admin adds team member → paytrack creates employee record
2. Paytrack API calls Docuseal API: `POST /api/submissions` with template ID + worker email
3. Docuseal sends e-sign email directly to worker
4. Worker completes e-sign in Docuseal UI (no paytrack page needed)
5. Docuseal fires webhook to `POST /api/compliance/esign-complete`
6. Paytrack marks `w9_signed` / `contract_signed` as true, stores Docuseal document ID

### One-Off Missing Doc Trigger

**Access:** Admin panel → Team Members → worker row → "Request W9" or "Request Contract" button (only shown when doc is missing).

**Flow:** Same as onboarding — calls Docuseal API, sends e-sign to worker.

**No reminder cadence for W9/contract** — one send, then manual follow-up if needed.

---

## Section 4 — Database Schema

### New Tables

```sql
-- Tracks active compliance requests (tokenized links)
compliance_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  type text not null, -- 'upload' | 'lookup' | 'esign'
  document_type text not null, -- 'coi' | 'professional_license' | 'w9' | 'contract'
  token text unique not null default gen_random_uuid()::text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
)

-- Stores compliance documents and extracted data
compliance_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  document_type text not null,
  storage_path text, -- Supabase Storage path (null for lookup-type)
  
  -- COI fields
  insurer_name text,
  policy_number text,
  expiration_date date,
  per_occurrence numeric,
  aggregate numeric,
  
  -- Professional license fields
  license_number text,
  license_type text,
  license_expiration_date date,
  
  -- Docuseal fields
  docuseal_submission_id text,
  
  -- Extraction metadata
  ai_extracted jsonb, -- raw AI output
  worker_confirmed_at timestamptz,
  worker_edits jsonb, -- { field: { original, corrected } }
  
  -- Admin review
  admin_approved_at timestamptz,
  admin_approved_by text,
  admin_action text, -- 'approved' | 'edited' | 'rejected'
  
  -- Status
  status text not null default 'pending', -- 'pending' | 'worker_confirmed' | 'approved' | 'rejected'
  created_at timestamptz default now()
)
```

### Additions to `employees` table

```sql
-- Add to existing employees table
professional_license_number text,
professional_license_type text, -- 'RN' | 'NP' | 'PA' | 'MD' | 'esthetician'
professional_license_expiry date,
coi_expiry date,
coi_insurer text,
w9_signed boolean default false,
contract_signed boolean default false,
```

---

## Section 5 — Nightly Scan (launchd)

**Schedule:** ~11:00 PM Pacific daily (Mac `com.lemed.compliance-scanner`).

**Script:** `paytrack/scripts/compliance-scanner.mjs`

**Logic:**
1. Query employees with COI expiring within 30 days or missing → fire COI Step 1 if no pending request
2. Query employees with license expiring within 30 days → fire license reminder if no recent reminder
3. Run BreEZe lookup for all employees with pending license renewals → auto-confirm if renewed
4. Log results, SMS Mike on errors

---

## Section 6 — Cloudflare Email Worker

**Route:** `coi@lemedspa.com`

**Script:** `cloudflare/email-workers/coi-receiver.js`

**Logic:**
1. Parse inbound email
2. Extract PDF attachment(s)
3. Match `from` address to employee by email in Supabase
4. Upload PDF to Supabase Storage
5. POST to paytrack API `/api/compliance/coi-received`
6. On no match: send auto-reply with upload link instructions

---

## Section 7 — New API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/compliance/coi-received` | Called by Cloudflare Email Worker after PDF extracted |
| GET | `/api/compliance/confirm/:token` | Returns pre-filled confirmation data for worker |
| POST | `/api/compliance/confirm/:token` | Worker submits confirmation (with any edits) |
| GET | `/api/compliance/review` | Admin queue — pending items awaiting review |
| POST | `/api/compliance/review/:id/approve` | Admin approves a document |
| POST | `/api/compliance/review/:id/reject` | Admin rejects, re-triggers Step 1 |
| POST | `/api/compliance/esign-complete` | Docuseal webhook — marks W9/contract complete |
| POST | `/api/compliance/trigger-esign` | Admin manually triggers W9 or contract send |

---

## Section 8 — Notifications

**Email provider:** Resend (`paytrack@lemedspa.com`)  
**SMS provider:** Twilio

### Email Templates

| Template | Trigger | Recipient |
|---|---|---|
| `coi-reminder` | Nightly scan finds expiring/missing COI | Worker |
| `coi-step2-confirm` | COI received + extraction complete | Worker |
| `coi-approved` | Mike approves | Worker ("All set! Your COI is on file.") |
| `license-reminder` | Nightly scan finds expiring license | Worker |
| `license-confirmed` | BreEZe lookup confirms renewal | Worker |
| `admin-review-queued` | Worker confirms COI | Mike (optional — or just badge on admin panel) |

---

## Known Decisions & Trade-offs

| Decision | Rationale |
|---|---|
| Email-forward as hero path | Zero friction — worker doesn't need to find a link; just forwards the email they already have |
| Two-touchpoint COI flow | Days may pass between Step 1 and document receipt. Step 2 is a fresh notification that doesn't assume Step 1 page is still open |
| BreEZe auto-lookup for licenses | Workers don't need to submit anything — system verifies directly. Reduces friction to zero for license renewals |
| Docuseal self-hosted on NAS | Free forever, API-capable, no per-seat fees, data stays internal |
| Warm tone throughout | Workers are contractors, not employees. Accusatory compliance language damages relationship. Assume good faith. |
| 30-day advance notice | Enough runway for workers to act without feeling harassed |
| Haiku for extraction | Already in use via `extract-insurance.mjs`. Cost-efficient for high-frequency document reads |
| Worker can edit extracted fields | AI OCR isn't perfect. Worker is the authoritative source. Edits are flagged for admin but don't block the flow |
| Admin review is always required for COI | Financial/legal document — human sign-off appropriate. Target: <15 seconds per item |

---

## Out of Scope

- Automatic renewal of insurance on worker's behalf
- Integration with insurance carriers
- HIPAA compliance review (workers are contractors, not patients)
- Multi-document COI support (one active COI per worker)
- Contract versioning / re-signing on contract changes
