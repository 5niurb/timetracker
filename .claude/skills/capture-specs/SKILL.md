---
description: Review the current session and extract/update requirements, acceptance criteria, and design decisions into SPECS.md. Use after completing features or at session end.
disable-model-invocation: true
---

# /capture-specs

Review the current session's work and update the project's `SPECS.md` file with any new or changed specifications.

## What to Do

1. **Identify the current project** from the working directory:
   - `lemedspa-website/` → `lemedspa-website/SPECS.md`
   - `lm-app/` → `lm-app/SPECS.md`
   - `timetracker/` → `timetracker/SPECS.md`

2. **Review the conversation history** for this session. Look for:
   - New features implemented
   - Components created or modified
   - Design decisions made (and the reasoning)
   - Acceptance criteria discussed or implied
   - UI/UX specifications mentioned by the user
   - API endpoints added or changed
   - Database schema changes
   - Bug fixes that reveal expected behavior

3. **Read the existing SPECS.md** for the project.

4. **Update SPECS.md** with any new information. Follow these rules:

### Update Rules

- **New component/page:** Add a new section with Purpose, Components table, Acceptance Criteria checklist, and Design Decisions
- **Modified component:** Update the existing section — don't duplicate, merge changes in
- **New acceptance criteria:** Add as `- [ ]` checklist items under the relevant component
- **Design decisions:** Add to the Design Decisions Log table at the bottom with today's date and the rationale
- **API changes:** Update endpoint tables with new routes, parameters, responses
- **Schema changes:** Update database tables section

### Format Rules

- Use the same markdown structure as existing SPECS.md sections
- Acceptance criteria are always `- [ ]` checkboxes (testable statements)
- Design decisions always include date + rationale
- Component tables use: Component | Description | Key behavior
- Keep descriptions concise but specific enough to rebuild from scratch
- Don't include implementation details (file paths, line numbers) — focus on WHAT, not HOW

### What NOT to Capture

- Session management notes (that's SESSION_NOTES.md)
- Temporary debugging steps
- Things that were tried and reverted
- Internal tooling changes (hooks, skills, agents)

5. **Commit the updated SPECS.md** with message: `[docs] Update SPECS.md with [brief description of what was captured]`

## Example Output

After a session where a "booking calendar" was added to lm-app:

```markdown
## Booking Calendar (`/booking`)

**Purpose:** Patient-facing appointment scheduling integrated with Cal.com.

**Components:**

| Component | Description | Key behavior |
|-----------|-------------|--------------|
| **Calendar view** | Weekly/monthly toggle, available slots highlighted | Fetches from Cal.com API |
| **Service selector** | Dropdown of treatments from services table | Filters available providers |
| **Confirmation** | Summary + SMS confirmation option | Sends via Twilio |

**Acceptance Criteria:**
- [ ] Calendar shows available slots from Cal.com
- [ ] Service selection filters to qualified providers
- [ ] Booking creates Cal.com event + database record
- [ ] SMS confirmation sent if opted in
- [ ] Mobile responsive (touch-friendly date selection)

**Design Decisions:**
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03 | Cal.com over custom calendar | Avoid reinventing scheduling logic, handles timezones |
```
