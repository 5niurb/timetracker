# Unified Auth & Paytrack Consolidation Design

> **For agentic workers:** This spec covers Phase 1 implementation only. Phase 2 (RBAC module permissions) and Phase 3 (SvelteKit migration) are documented for architectural context but are NOT in scope for the implementation plan derived from this spec.

**Goal:** Consolidate paytrack's Express backend into lm-app's API, implement shared passkey/WebAuthn authentication with device and network trust, and define the RBAC module permission model for future implementation.

**Architecture:** Single Express API (`api.lemedspa.app`) serves paytrack, lm-app, and lm-mobile. Supabase Auth is the identity backbone. Passkeys (Face ID / Windows Hello) are the primary credential. Scoped JWTs control what each user/device can access.

**Tech Stack:** Node.js, Express, Supabase Auth, `@simplewebauthn/server`, `@simplewebauthn/browser`, Fly.io, Supabase PostgreSQL

---

## 1. Identity & Access Model

Four distinct principals, each with a defined trust mechanism and scope:

| Principal | Identity | Device Trust | Network Trust | Scope |
|---|---|---|---|---|
| Employee | Named Supabase Auth user | Own iPhone passkey | Any | `paytrack` |
| Spa Station (on-network) | Named device account | Registered device fingerprint | Spa LAN `192.168.0.0/24` | `lm-app` |
| Spa Station (off-network) | Named device account | Registered device fingerprint | Not spa LAN | Blocked — admin password required |
| Admin (Mike) | Supabase Auth user | Tailscale `100.71.117.49` OR passkey | Any | `admin` |
| Admin (Lea) | Supabase Auth user | Tailscale OR device fingerprint OR passkey | Any | `admin` |

### Roles

| Role | Who | Capabilities |
|---|---|---|
| `super-admin` | Mike | Everything: all modules, delete employees, revoke devices, manage roles |
| `admin` | Lea | All modules, all data — no destructive ops or account management |
| `front-desk` | Spa shared stations | `comms.phone`, `comms.sms`, `crm.contacts` |
| `provider` | Future named provider accounts | `comms.phone`, `crm.contacts`, `crm.services` |
| `employee` | All named employees | `paytrack.time`, `paytrack.pay`, `paytrack.onboarding` |

### Module Registry (Phase 2 — documented now for architectural alignment)

| Module ID | Label | Default Roles |
|---|---|---|
| `paytrack.time` | Time & Attendance | employee |
| `paytrack.pay` | Pay & Invoices | employee |
| `paytrack.onboarding` | Onboarding | employee |
| `paytrack.admin` | Paytrack Admin | super-admin, admin |
| `comms.phone` | Phone & Calls | front-desk, provider |
| `comms.sms` | SMS Messaging | front-desk |
| `crm.contacts` | Contacts | front-desk, provider |
| `crm.services` | Services Catalog | provider |
| `crm.automation` | Automations | super-admin, admin |
| `ops.reports` | Reports | super-admin, admin |
| `ops.admin` | System Settings | super-admin |

---

## 2. Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Employee   │  │  Spa iPad 1  │  │  Spa iMac    │  │  Mike / Lea  │
│  own iPhone  │  │ care@ipad1   │  │ care@imac    │  │ (admin)      │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │                  │
       └─────────────────┴─────────────────┴──────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     api.lemedspa.app         │
                    │  (lm-app Express, Fly.io)    │
                    │                              │
                    │  /api/auth/*                 │
                    │  /api/paytrack/*             │
                    │  /api/*  (existing lm-app)   │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │           Supabase            │
                    │  auth.users                   │
                    │  passkeys                     │
                    │  device_registrations         │
                    │  webauthn_challenges          │
                    │  modules / roles / role_modules│
                    │  user_roles                   │
                    │  employees (paytrack)         │
                    │  [all existing lm-app tables] │
                    └──────────────────────────────┘
```

### JWT Scope Claim

Every session JWT contains a `scope` claim set at login time:

```json
// Employee on own iPhone
{ "sub": "user-uuid", "scope": "paytrack", "roles": ["employee"] }

// Spa device on spa LAN
{ "sub": "device-uuid", "scope": "lm-app", "roles": ["front-desk"], "device_id": "ipad1-uuid" }

// Admin
{ "sub": "user-uuid", "scope": "admin", "roles": ["super-admin"] }
```

Scope middleware wraps all route groups:
- `requireScope('paytrack')` — blocks lm-app and admin tokens from paytrack routes
- `requireScope('lm-app')` — blocks paytrack tokens from lm-app routes
- `requireScope('admin')` — admin only

---

## 3. Database Schema

```sql
-- Link paytrack employees to Supabase Auth users
ALTER TABLE employees
  ADD COLUMN user_id uuid REFERENCES auth.users(id);

-- Registered spa devices
CREATE TABLE device_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  device_fingerprint text NOT NULL UNIQUE,
  trusted_networks jsonb DEFAULT '[]',   -- e.g. ["192.168.0.0/24"]
  scope text NOT NULL,                   -- 'lm-app' | 'paytrack' | 'admin'
  registered_at timestamptz DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- WebAuthn passkeys (employees + admins)
CREATE TABLE passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_name text,
  aaguid text,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

-- Short-lived WebAuthn challenges (5 min TTL)
CREATE TABLE webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL,
  user_id uuid,                          -- null for login/start (user unknown)
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RBAC: modules (Phase 2 — create table now, seed in Phase 2)
CREATE TABLE modules (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text
);

-- RBAC: roles
CREATE TABLE roles (
  id text PRIMARY KEY,
  label text NOT NULL
);

-- RBAC: role → module grants
CREATE TABLE role_modules (
  role_id text REFERENCES roles(id) ON DELETE CASCADE,
  module_id text REFERENCES modules(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, module_id)
);

-- RBAC: user → role assignments
CREATE TABLE user_roles (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id text REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
```

### RLS Policies

- `passkeys` — service role only for insert/update; users can select/delete their own rows
- `device_registrations` — service role only for insert/update/delete; device can select its own row
- `webauthn_challenges` — service role only
- `modules`, `roles`, `role_modules` — read-only for authenticated users; write via service role only
- `user_roles` — service role only

### Employee Migration Script (one-time)

For each row in `employees`:
1. Create `auth.users` account: email `{firstname.lastname}@paytrack.internal`, random password
2. Set `employees.user_id` to new `auth.users.id`
3. Create `user_roles` row: `role_id = 'employee'`

For Mike and Lea:
1. Create `auth.users` with real email
2. Assign `super-admin` (Mike) and `admin` (Lea) roles
3. Register Tailscale IPs in server config

---

## 4. Auth Endpoints

All under `/api/auth/` in lm-app Express API:

### Passkey Registration

```
POST /api/auth/passkey/register/start
  Requires: valid session OR PIN (employees) OR password (admin)
  Returns:  { challengeId, options } — WebAuthn registration options

POST /api/auth/passkey/register/finish
  Body:     { challengeId, registrationResponse, deviceName }
  Action:   Verifies challenge, stores credential in passkeys table
  Returns:  { success, passkeyId }
```

### Passkey Login

```
POST /api/auth/passkey/login/start
  Body:     { app } — 'paytrack' | 'lm-app'
  Returns:  { challengeId, options } — WebAuthn authentication options

POST /api/auth/passkey/login/finish
  Body:     { challengeId, authenticationResponse }
  Action:   Verifies credential, updates counter, issues scoped Supabase session
  Returns:  { access_token, refresh_token, user, scope, roles }
```

### Tailscale Bypass

```
POST /api/auth/tailscale
  Action:   Checks request IP against allowlist ['100.71.117.49', <Lea Tailscale IP>]
  Returns:  { access_token, refresh_token, user, scope: 'admin' } or 403
```

### Device Trust Login

```
POST /api/auth/device
  Body:     { deviceFingerprint }
  Headers:  X-Forwarded-For (client IP, set by Fly.io)
  Action:   Looks up device_registrations, checks network trust
            → On-network: issues scoped session
            → Off-network: returns 403 { reason: 'off-network' }
            → Admin password in body: overrides network check, issues session
  Returns:  { access_token, refresh_token, scope, roles } or 403
```

### Device Management

```
POST /api/auth/device/register
  Requires: super-admin password
  Body:     { deviceFingerprint, deviceName, scope, trustedNetworks }
  Returns:  { success, deviceId }

DELETE /api/auth/passkey/:passkeyId
  Requires: valid session
  Action:   Admin can delete any; employee can only delete their own
  Returns:  { success }

DELETE /api/auth/device/:deviceId
  Requires: super-admin session
  Returns:  { success }
```

### PIN Fallback (paytrack employees)

```
POST /api/auth/pin/verify
  Body:     { pin }
  Returns:  { access_token, refresh_token, user, scope: 'paytrack' }

POST /api/auth/pin/change
  Requires: valid session
  Body:     { currentPin, newPin }
  Action:   Updates PIN, deletes ALL passkeys for this user_id
  Returns:  { success }
```

---

## 5. Auth Flow Diagrams

### Employee Login (own iPhone)
```
1. Visit paytrack.lemedspa.app
2. Browser checks localStorage for passkey credential
   → Has passkey:  Face ID prompt → POST /api/auth/passkey/login/finish
   → No passkey:   PIN entry → POST /api/auth/pin/verify
                               → soft prompt to register Face ID
3. Server issues JWT { scope: 'paytrack', roles: ['employee'] }
4. Paytrack UI loads — only paytrack modules visible
```

### Spa Device Login (on spa LAN)
```
1. Visit lemedspa.app on spa iPad
2. Browser sends device_fingerprint → POST /api/auth/device
3. Server checks:
   → device_fingerprint in device_registrations? YES
   → IP in 192.168.0.0/24? YES
   → Issue JWT { scope: 'lm-app', roles: ['front-desk'] }
4. lm-app UI loads — no login screen shown
```

### Spa Device Login (off spa LAN)
```
1. Same device, different network
2. POST /api/auth/device → 403 { reason: 'off-network' }
3. UI shows: "This device must be on the spa network.
              Admin password to override:"
4. Admin password submitted → JWT issued with scope: 'lm-app'
```

### Admin Login (Tailscale)
```
1. Visit any app from Tailscale IP
2. POST /api/auth/tailscale
3. Server verifies IP → issues JWT { scope: 'admin', roles: ['super-admin'] }
4. Full access, no credential prompt
```

### Admin Login (non-Tailscale, passkey)
```
1. Face ID (iPhone) or Windows Hello (laptop)
2. POST /api/auth/passkey/login/finish
3. JWT { scope: 'admin', roles: ['super-admin' | 'admin'] }
```

### New Spa Device Setup
```
1. Visit /setup/device on the device (super-admin password required)
2. Enter device name ("Spa iPad 1")
3. Device fingerprint generated, stored in device_registrations
4. Subsequent visits on spa LAN auto-authenticate
```

---

## 6. Paytrack Consolidation

### Route Migration

All paytrack Express routes move to `lm-app/api/routes/paytrack/`, namespaced under `/api/paytrack/`:

| New path | Old path | File |
|---|---|---|
| `/api/paytrack/employees` | `/api/admin/employees` | `routes/paytrack/employees.js` |
| `/api/paytrack/time-entries` | `/api/time-entry` | `routes/paytrack/time-entries.js` |
| `/api/paytrack/invoices` | `/api/submit-invoice` | `routes/paytrack/invoices.js` |
| `/api/paytrack/onboarding` | `/api/onboarding` | `routes/paytrack/onboarding.js` |
| `/api/paytrack/compliance` | `/api/admin/...compliance` | `routes/paytrack/compliance.js` |
| `/api/paytrack/plaid` | `/api/admin/plaid` | `routes/paytrack/plaid.js` |
| `/api/paytrack/pay-periods` | `/api/pay-period` | `routes/paytrack/pay-periods.js` |

### Lib Migration

All paytrack utility modules move to `lm-app/api/lib/paytrack/`:
- `pay-periods.js`, `crypto.js`, `onboarding-validation.js`
- `compliance-tokens.js`, `coi-extractor.mjs`, `compliance-notifications.mjs`

### Static File Serving

Paytrack's `public/` directory (HTML/CSS/JS) is served as static assets from lm-app's Express app. `paytrack.lemedspa.app` DNS CNAME → `lm-app-api.fly.dev`. Paytrack frontend JS updated to call `api.lemedspa.app/api/paytrack/...`.

### Auth Migration in Paytrack Frontend

- Admin password header auth replaced by JWT bearer token
- Employee PIN sessionStorage replaced by JWT stored in localStorage
- Passkey registration prompt added after first PIN login

### Render Decommission

After cutover verified:
1. Update `paytrack.lemedspa.app` DNS CNAME to `lm-app-api.fly.dev`
2. Verify all routes respond correctly
3. Suspend Render service (`srv-d632r5m8alac73cbqubg`)

---

## 7. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| Device stolen off-network | 403 returned; admin password override required |
| Employee leaves | Admin deactivates → `auth.users` disabled → all sessions/passkeys CASCADE invalidated |
| PIN change | Deletes all `passkeys` rows for user_id; next login uses PIN, prompts to re-register |
| Challenge expiry | 5-minute TTL; client gets clear error "Session expired, try again"; pg_cron cleans up hourly |
| No passkey registered yet | PIN login works normally; soft prompt to register Face ID after login |
| Tailscale not connected (admin) | Falls back to passkey (Face ID / Windows Hello); no access degradation |
| New employee | Onboarding link flow creates auth.users account; passkey registration prompted on first login |
| Revoke specific device | Admin panel Devices tab → revoke button → `device_registrations.revoked_at` set → 403 on next request |

---

## 8. Security Considerations

- All auth endpoints rate-limited (10 req/min per IP)
- WebAuthn replay attacks prevented by counter increment verification
- Challenges are single-use and expire in 5 minutes
- Device fingerprints are UUIDs generated client-side, stored in localStorage — not secret, but combined with network check provide meaningful trust signal
- Tailscale IP allowlist is server-side only — never exposed to client
- Admin password override for off-network spa devices is rate-limited and logged
- Security review (OWASP Top 10) mandatory before shipping Phase 1
- `@simplewebauthn/server` handles all WebAuthn crypto — no custom crypto

---

## 9. Implementation Phases

### Phase 1 — Consolidation + Auth (this plan)
1. Migrate paytrack routes and libs into lm-app API
2. Serve paytrack static files from lm-app Express
3. Run employee migration script (create Supabase Auth users)
4. Implement all `/api/auth/` endpoints
5. Add scope middleware to all route groups
6. Update paytrack frontend for new API URLs and JWT auth
7. Register RBAC tables (create schema, seed roles — no enforcement yet)
8. Decommission Render, update DNS

### Phase 2 — RBAC Module Permissions (next cycle)
- Seed modules table, assign role_modules
- Add module permission checks to all routes
- Module-aware nav in paytrack and lm-app frontends
- Admin UI: assign roles, toggle modules per user
- lm-mobile respects module grants for tab visibility

### Phase 3 — Paytrack Frontend Migration (future)
- Migrate paytrack HTML/JS to SvelteKit pages in lm-app
- Unified design system, shared components
