---
name: postgres-patterns
description: PostgreSQL/Supabase quick reference — indexing, RLS, cursor pagination, anti-pattern detection. Complements the database-reviewer agent.
---

# PostgreSQL Patterns (Supabase)

Quick reference for both lm-app and timetracker Supabase databases.

## When to Activate

- Writing SQL queries or migrations
- Designing database schemas
- Troubleshooting slow queries
- Implementing Row Level Security

## Index Cheat Sheet

| Query Pattern | Index Type | Example |
|---|---|---|
| `WHERE col = value` | B-tree (default) | `CREATE INDEX idx ON t (col)` |
| `WHERE col > value` | B-tree | `CREATE INDEX idx ON t (col)` |
| `WHERE a = x AND b > y` | Composite | `CREATE INDEX idx ON t (a, b)` |
| `WHERE jsonb @> '{}'` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| Full-text search | GIN | `CREATE INDEX idx ON t USING gin (col)` |

## Data Type Reference

| Use Case | Correct Type | Avoid |
|---|---|---|
| IDs | `bigint` or `uuid` | `int` |
| Strings | `text` | `varchar(255)` |
| Timestamps | `timestamptz` | `timestamp` |
| Money | `numeric(10,2)` | `float` |
| Flags | `boolean` | `varchar`, `int` |

## Common Patterns

**Composite index — equality first, then range:**
```sql
CREATE INDEX idx ON appointments (status, created_at);
-- Works for: WHERE status = 'confirmed' AND created_at > '2026-01-01'
```

**Partial index — smaller, faster:**
```sql
CREATE INDEX idx ON clients (email) WHERE deleted_at IS NULL;
```

**RLS policy (optimized with SELECT wrapper):**
```sql
CREATE POLICY policy ON appointments
  USING ((SELECT auth.uid()) = provider_id);
```

**Cursor pagination (O(1) vs OFFSET O(n)):**
```sql
SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT 20;
```

**UPSERT:**
```sql
INSERT INTO settings (user_id, key, value)
VALUES (123, 'theme', 'dark')
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value;
```

**Queue processing (skip locked):**
```sql
UPDATE jobs SET status = 'processing'
WHERE id = (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at LIMIT 1
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

## Anti-Pattern Detection

```sql
-- Find unindexed foreign keys
SELECT conrelid::regclass, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
  );

-- Find slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;
```

## Related

- Agent: `database-reviewer` — Full database review workflow
- Skill: `api-design` — API patterns using these DB patterns
