---
name: database-migrations
description: Safe Supabase migration patterns — schema changes, data migrations, rollbacks, zero-downtime deployments.
---

# Database Migration Patterns (Supabase)

Safe, reversible schema changes for lm-app and timetracker.

## When to Activate

- Creating or altering tables
- Adding/removing columns or indexes
- Running data migrations (backfill, transform)
- Planning zero-downtime schema changes

## Core Principles

1. **Every change is a migration** — never alter production manually
2. **Schema and data migrations are separate** — never mix DDL and DML
3. **Test against production-sized data** — works on 100 rows, may lock on 10M
4. **Migrations are immutable once deployed** — never edit a deployed migration

## Safety Checklist

Before applying any migration:
- [ ] New columns are nullable OR have defaults (never NOT NULL without default)
- [ ] Indexes created with CONCURRENTLY (for existing tables)
- [ ] Data backfill is a separate migration from schema change
- [ ] Rollback plan documented
- [ ] Tested in Supabase branch or staging

## Adding a Column Safely

```sql
-- GOOD: Nullable column, no lock
ALTER TABLE clients ADD COLUMN avatar_url TEXT;

-- GOOD: Column with default (Postgres 11+ is instant)
ALTER TABLE clients ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- BAD: NOT NULL without default (rewrites entire table, locks it)
ALTER TABLE clients ADD COLUMN role TEXT NOT NULL;
```

## Adding an Index Without Downtime

```sql
-- BAD: Blocks writes on large tables
CREATE INDEX idx_clients_email ON clients (email);

-- GOOD: Non-blocking
CREATE INDEX CONCURRENTLY idx_clients_email ON clients (email);
-- Note: CONCURRENTLY cannot run inside a transaction block
```

## Renaming a Column (Zero-Downtime)

Use expand-contract pattern:
```sql
-- Migration 1: Add new column
ALTER TABLE clients ADD COLUMN display_name TEXT;

-- Migration 2: Backfill (separate migration)
UPDATE clients SET display_name = full_name WHERE display_name IS NULL;

-- Deploy app code that reads/writes BOTH columns
-- Migration 3: Drop old column
ALTER TABLE clients DROP COLUMN full_name;
```

## Large Data Migrations

```sql
-- BAD: Locks entire table
UPDATE clients SET normalized_email = LOWER(email);

-- GOOD: Batch update
DO $$
DECLARE
  batch_size INT := 10000;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE clients
    SET normalized_email = LOWER(email)
    WHERE id IN (
      SELECT id FROM clients
      WHERE normalized_email IS NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
    COMMIT;
  END LOOP;
END $$;
```

## Supabase Workflow

```bash
# Apply via Supabase MCP or dashboard
# Use supabase CLI for local dev:
supabase migration new add_client_avatar
supabase db push
supabase db reset  # dev only
```

Or use the Supabase MCP tool: `apply_migration`

## Anti-Patterns

| Anti-Pattern | Better Approach |
|---|---|
| Manual SQL in production | Always use migration files |
| NOT NULL without default | Add nullable, backfill, then add constraint |
| Inline index on large table | CREATE INDEX CONCURRENTLY |
| Schema + data in one migration | Separate migrations |
| Drop column before removing code | Remove code first, drop column next deploy |
