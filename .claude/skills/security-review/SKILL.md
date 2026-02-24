---
name: security-review
description: Security patterns for Express + Supabase — input validation, SQL injection, XSS, auth, RLS, secrets management. Auto-activate on auth/payment/PII code.
---

# Security Review Patterns

Comprehensive security reference for lm-app and timetracker.

## When to Activate

- Implementing authentication or authorization
- Handling user input or file uploads
- Creating new API endpoints
- Working with Stripe payments
- Storing patient/client data (PII)

## 1. Secrets Management

```javascript
// NEVER hardcode
const apiKey = "sk-proj-xxxxx"  // ❌

// ALWAYS use env vars
const apiKey = process.env.STRIPE_SECRET_KEY  // ✅
if (!apiKey) throw new Error('STRIPE_SECRET_KEY not configured')
```

- All secrets in platform dashboards (Cloudflare/Render/Supabase)
- `.env` blocker hook prevents accidental edits
- No `.env` files committed — ever

## 2. Input Validation

```javascript
// Validate all user input before processing
function validateAppointment(body) {
  const errors = [];
  if (!body.client_id || typeof body.client_id !== 'string') errors.push('Invalid client_id');
  if (!body.service_id || typeof body.service_id !== 'string') errors.push('Invalid service_id');
  if (!body.date || isNaN(Date.parse(body.date))) errors.push('Invalid date');
  if (errors.length) return { valid: false, errors };
  return { valid: true, data: { client_id: body.client_id, service_id: body.service_id, date: body.date } };
}
```

## 3. SQL Injection Prevention

```javascript
// NEVER concatenate user input into SQL
const query = `SELECT * FROM clients WHERE email = '${email}'`  // ❌

// ALWAYS use Supabase client (parameterized)
const { data } = await supabase.from('clients').select('*').eq('email', email)  // ✅

// Or parameterized raw SQL
await supabase.rpc('search_clients', { search_email: email })  // ✅
```

## 4. Authentication & Row Level Security

```sql
-- Enable RLS on ALL tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Clients visible only to their provider
CREATE POLICY "Providers see own clients"
  ON clients FOR SELECT
  USING ((SELECT auth.uid()) = provider_id);

-- Clients can update own profile
CREATE POLICY "Clients update own data"
  ON clients FOR UPDATE
  USING ((SELECT auth.uid()) = id);
```

## 5. XSS Prevention

```javascript
// Sanitize any user-provided HTML before rendering
// For the website (vanilla JS): use textContent, not innerHTML
element.textContent = userInput;  // ✅ Safe
element.innerHTML = userInput;    // ❌ XSS vulnerability

// For lm-app (SvelteKit): Svelte auto-escapes by default
// Only {@html ...} is dangerous — never use with user input
```

## 6. Error Messages

```javascript
// NEVER expose internal details
catch (error) {
  res.status(500).json({ error: error.message, stack: error.stack })  // ❌
}

// ALWAYS return generic errors to clients
catch (error) {
  console.error('Internal error:', error)  // Log details server-side
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } })  // ✅
}
```

## 7. Rate Limiting (Express)

```javascript
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  message: { error: { code: 'rate_limit', message: 'Too many requests' } }
});

app.use('/api/', apiLimiter);

// Stricter for auth endpoints
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });
app.use('/api/auth/', authLimiter);
```

## Pre-Commit Checklist

- [ ] No hardcoded secrets
- [ ] All user inputs validated
- [ ] Supabase queries use client (not string concatenation)
- [ ] RLS enabled on new tables
- [ ] Error messages don't leak internals
- [ ] No `.env` files staged
- [ ] Rate limiting on public endpoints

## Auto-Trigger

Spawn `security-reviewer` agent automatically when touching:
- Auth/login/session code
- Stripe/payment processing
- Patient/PII data handling
- API route definitions
