# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/` (workspace level — inherited by all projects):

| Agent | Purpose | Model | When to Use |
|-------|---------|-------|-------------|
| code-reviewer | Zero-context code review | Sonnet | After writing/modifying code |
| qa | Test generation + execution | Sonnet | After code review passes |
| research | Deep investigation (web + files) | Sonnet | Complex questions, docs lookup |
| email-classifier | Email triage (Action/Waiting/Reference) | Sonnet | Inbox processing |
| database-reviewer | PostgreSQL/Supabase specialist | Sonnet | SQL, schema, or Supabase changes |
| security-reviewer | OWASP Top 10 analysis | Opus | Auth, payments, PII, API routes |
| architect | Read-only system design | Opus | Architectural decisions, trade-offs |
| build-error-resolver | Minimal-diff build fixes | Sonnet | When build fails |
| deploy-verifier | Post-deploy health checks | Sonnet | After deploying to production |

Project-specific agents (committed to each repo's `.claude/agents/`):
- **lemedspa-website**: `accessibility-reviewer` — WCAG 2.1 AA compliance

## Design & Build Workflow

Subagents are **read-only reporters**. All code changes happen in the parent agent.

1. **Write/edit the code**
2. **Code Review** — Spawn `code-reviewer` with changed files
3. **Security Review** (if touching auth, payments, PII, API routes) — Spawn `security-reviewer`
4. **Database Review** (if touching SQL, schema, Supabase) — Spawn `database-reviewer`
5. **QA** — Spawn `qa` with changed files
6. **Fix** — Parent reads reports and applies fixes
7. **Ship** — Only after review passes and tests pass

For complex features, use `/orchestrate feature <description>` to run the full pipeline.

## Parallel Execution

ALWAYS spawn independent subagents in parallel using `run_in_background: true`:

```
# GOOD: Independent reviews in parallel
Task(code-reviewer, run_in_background: true)
Task(security-reviewer, run_in_background: true)

# BAD: Sequential when they don't depend on each other
First code-reviewer, wait, then security-reviewer, wait
```

## Model Routing

Use the cheapest model that handles the task:

| Task | Model | Why |
|------|-------|-----|
| File exploration, codebase search | **Haiku** | Fast, cheap, no deep reasoning needed |
| Code review, QA, database review | **Sonnet** | Needs judgment, not architecture |
| Architecture, security analysis | **Opus** | High stakes, complex trade-offs |
| Documentation generation | **Haiku** | Mostly templated output |
