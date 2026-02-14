# CLAUDE.md — timetracker (LM PayTrack)

## What This Is

Employee time & payroll tracking PWA for Le Med Spa staff.
- **App name:** LM PayTrack
- **Repo:** github.com/5niurb/timetracker
- **Tech:** Node.js, Express, Supabase (PostgreSQL), vanilla JS frontend
- **Deployment:** Render.com (auto-deploys on push to main)
- **Production URL:** https://lm-paytrack.onrender.com

## Running Locally

```bash
npm run dev    # Starts server on port 3000 with --watch
```

Requires `.env` file with:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `RESEND_API_KEY` (optional — for invoice emails)
- `ADMIN_PASSWORD` (optional — defaults to hardcoded value)

## Key Files

- `server.js` — Express API (all routes, Supabase client, pay period logic)
- `public/index.html` — Employee app (PIN login, time entry, pay review, invoice)
- `public/admin.html` — Admin panel (review entries, employees, reports)
- `supabase-schema.sql` — Database schema (paste into Supabase SQL Editor)
- `render.yaml` — Render deployment config

## Database

All data lives in Supabase PostgreSQL. Tables:
- `employees` — name, PIN, email, hourly_wage, pay_type
- `time_entries` — date, hours, start/end times, breaks
- `client_entries` — patient services (linked to time_entry)
- `product_sales` — product commissions (linked to time_entry)
- `invoices` — submitted pay period invoices

Schema: `supabase-schema.sql` — run in Supabase SQL Editor to set up.

## Pay Periods

26 pay periods per year:
- **1st–15th** of each month
- **16th–end** of each month

All dates use Los Angeles timezone (`America/Los_Angeles`).

## Features

### Employee App (`/`)
- PIN-based login (4 digits)
- Two tabs: **Daily Entry** (time + services + sales) and **Pay Review** (period summary)
- Invoice preview with daily breakdown
- Delete entries from Pay Review tab

### Admin Panel (`/admin`)
- **Review Entries** — Pay period navigation with arrows, employee filter, daily breakdown table
- **Employees** — Add/edit/delete employees, set pay type and hourly wage
- **Reports** — Date range reports with earnings by employee

## Conventions

- No frameworks — plain Express + vanilla JS
- Direct Supabase client calls (no ORM)
- LA timezone for all date logic
- Pay period navigation uses offset from current period (0 = current, -1 = previous, etc.)

## Deployment

Render auto-deploys on push to `main`. Manual deploy:
```bash
git push origin main
# Wait ~2-3 min for Render to rebuild
```

Keep-alive ping runs every 14 minutes to prevent free tier spin-down.

## Environment Variables (Production)

Set in Render dashboard:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `RESEND_API_KEY`
- `ADMIN_PASSWORD`
- `PORT` (Render sets automatically)
- `RENDER_EXTERNAL_URL` (for keep-alive pings)
- `NODE_ENV=production`

## Email

Invoice emails sent via Resend:
- **From:** `paytrack@updates.lemedspa.com`
- **To:** `lea@lemedspa.com`, `ops@lemedspa.com`
- **CC:** Employee email (if set)

## Claude Code Automations

### Skills (`.claude/skills/`)
- **`/commit`** — Stage, commit, push with formatted message
- **`/deploy`** — Push to main and verify Render deployment

### Inherited from Workspace
- **Prettier auto-format** hook — Formats JS/HTML/CSS on every edit
- **`.env` blocker** hook — Prevents accidental edits to sensitive files

## Recent Changes

- Migrated from SQLite to Supabase PostgreSQL
- Admin Review Entries tab with pay period navigation
- Employee Pay Review tab with delete functionality
- LA timezone sync for all dates
- "Patient Name" and "Services" labels in entry details
