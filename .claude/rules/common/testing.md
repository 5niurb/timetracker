# Testing

## QA Agent Workflow

Use the `qa` agent after code review passes:
1. Spawn `qa` with the modified files
2. Agent generates tests, runs them, reports pass/fail
3. Agent does NOT fix failures — parent agent reads the report and fixes
4. Re-run QA if needed (max 2 cycles)

## When to Run QA

- After implementing a feature or bugfix (non-trivial code)
- After the `/orchestrate` pipeline (Stage 4)
- Before shipping changes to production

## When QA is Optional

- Vanilla HTML/CSS changes (lemedspa-website) — visual verification instead
- Documentation-only changes
- Config file updates
- Simple content edits

## Test Troubleshooting

If tests fail:
1. Read the QA report carefully
2. Fix the implementation, not the tests (unless tests are wrong)
3. Check test isolation — tests shouldn't depend on each other
4. Re-run QA to confirm fixes
5. Max 2 retry cycles to prevent infinite loops

## Visual Verification (lemedspa-website)

For the website project, visual verification replaces automated testing:
1. Open the page in browser (Chrome MCP or `npx serve v2/`)
2. Inspect changed elements for overflow, spacing, alignment
3. Check mobile responsiveness (375px width)
4. Fix issues before committing
