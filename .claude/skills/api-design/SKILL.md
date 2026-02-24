---
name: api-design
description: REST API design patterns for Express + Supabase — resource naming, status codes, pagination, filtering, error responses, and rate limiting.
---

# API Design Patterns

Conventions for consistent Express + Supabase REST APIs (lm-app and timetracker).

## When to Activate

- Designing new API endpoints
- Adding pagination, filtering, or sorting
- Implementing error handling for APIs
- Reviewing existing API contracts

## Resource Design

```
# Resources: nouns, plural, lowercase, kebab-case
GET    /api/v1/clients
GET    /api/v1/clients/:id
POST   /api/v1/clients
PATCH  /api/v1/clients/:id
DELETE /api/v1/clients/:id

# Sub-resources for relationships
GET    /api/v1/clients/:id/appointments

# Actions (use verbs sparingly)
POST   /api/v1/appointments/:id/cancel
POST   /api/v1/auth/login
```

## Status Codes

```
# Success
200 OK                    — GET, PATCH (with response body)
201 Created               — POST (include Location header)
204 No Content            — DELETE

# Client Errors
400 Bad Request           — Validation failure, malformed JSON
401 Unauthorized          — Missing or invalid authentication
403 Forbidden             — Authenticated but not authorized
404 Not Found             — Resource doesn't exist
409 Conflict              — Duplicate entry, state conflict
422 Unprocessable Entity  — Valid JSON, bad data
429 Too Many Requests     — Rate limit exceeded

# Server Errors
500 Internal Server Error — Never expose details to client
```

## Response Format

### Success
```json
{ "data": { "id": "abc-123", "name": "Client Name" } }
```

### Collection (with pagination)
```json
{
  "data": [...],
  "meta": { "total": 142, "page": 1, "per_page": 20, "total_pages": 8 },
  "links": { "next": "/api/v1/clients?page=2&per_page=20" }
}
```

### Error
```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Must be a valid email", "code": "invalid_format" }
    ]
  }
}
```

## Pagination

### Offset (simple, for admin dashboards)
```
GET /api/v1/clients?page=2&per_page=20

SELECT * FROM clients ORDER BY created_at DESC LIMIT 20 OFFSET 20;
```

### Cursor (scalable, for feeds/infinite scroll)
```
GET /api/v1/appointments?cursor=eyJpZCI6MTIzfQ&limit=20

SELECT * FROM appointments WHERE id > :cursor_id ORDER BY id ASC LIMIT 21;
```

Use offset for admin views (<10K rows), cursor for client-facing lists.

## Filtering & Sorting

```
GET /api/v1/appointments?status=confirmed&provider_id=abc-123
GET /api/v1/products?price[gte]=10&price[lte]=100
GET /api/v1/clients?sort=-created_at
GET /api/v1/clients?fields=id,name,email
```

## Express Implementation Pattern

```javascript
// routes/clients.js
router.get('/api/v1/clients', async (req, res) => {
  const { page = 1, per_page = 20, sort = '-created_at' } = req.query;
  const offset = (page - 1) * per_page;

  const { data, count, error } = await supabase
    .from('clients')
    .select('id, name, email, phone, created_at', { count: 'exact' })
    .order(sort.replace('-', ''), { ascending: !sort.startsWith('-') })
    .range(offset, offset + per_page - 1);

  if (error) return res.status(500).json({ error: { code: 'db_error', message: 'Failed to fetch clients' } });

  res.json({
    data,
    meta: { total: count, page: +page, per_page: +per_page, total_pages: Math.ceil(count / per_page) }
  });
});
```

## Checklist

Before shipping a new endpoint:
- [ ] URL follows naming conventions (plural, kebab-case)
- [ ] Correct HTTP method and status codes
- [ ] Input validated (Zod or manual checks)
- [ ] Error responses follow standard format
- [ ] Pagination on list endpoints
- [ ] Auth required (or explicitly public)
- [ ] No internal details leaked in errors
