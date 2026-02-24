---
name: orchestrate
description: Chain agents sequentially through a full development pipeline. Runs planner → implement → code-reviewer → qa → verify. Supports feature, bugfix, and refactor modes.
argument-hint: feature|bugfix|refactor <description>
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Orchestrate — Development Pipeline

Chains agents through a sequential pipeline. Each stage writes output to `.claude/pipeline/`, and the next stage reads it. The pipeline adapts based on mode.

## Arguments

Parse from: $ARGUMENTS

Format: `<mode> <description>`

| Mode | Pipeline | Focus |
|---|---|---|
| `feature` | plan → implement → review → qa → verify | Full pipeline, architecture-first |
| `bugfix` | diagnose → fix → review → qa → verify | Root cause analysis, minimal fix |
| `refactor` | analyze → implement → review → qa → verify | Preserve behavior, improve structure |

If no mode specified, default to `feature`.

## Pipeline Setup

1. **Create pipeline directory:**
   ```bash
   mkdir -p .claude/pipeline
   TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
   PIPELINE_DIR=".claude/pipeline/${TIMESTAMP}_<mode>"
   mkdir -p "$PIPELINE_DIR"
   ```

2. **Write pipeline manifest:**
   ```
   # Pipeline: <mode>
   # Started: <timestamp>
   # Description: <description>
   # Status: IN_PROGRESS
   ```

## Pipeline Stages

### Stage 1: Plan / Diagnose / Analyze

Always spawn the `architect` agent for Stage 1 — regardless of mode. It runs in isolated context (Opus model), keeping the main conversation clean. Pass it the mode and description.

**Feature mode — Plan:**
- Spawn `architect` agent with: "Plan a feature implementation for: <description>. Identify files to change, data flow, and architectural impact."
- Agent writes plan to `$PIPELINE_DIR/01-plan.md`

**Bugfix mode — Diagnose:**
- Spawn `architect` agent with: "Diagnose this bug: <description>. Trace the code path, identify root cause, and list affected files."
- Agent writes diagnosis to `$PIPELINE_DIR/01-diagnosis.md`

**Refactor mode — Analyze:**
- Spawn `architect` agent with: "Analyze for refactoring: <description>. Map current structure, identify what to change, and what behavior to preserve."
- Agent writes analysis to `$PIPELINE_DIR/01-analysis.md`

### Stage 2: Implement

- Make the actual code changes based on Stage 1 output
- For bugfix mode: minimal diff only — fix the bug, nothing else
- For refactor mode: preserve all existing behavior
- Write a summary of changes to `$PIPELINE_DIR/02-changes.md`:
  ```
  ## Changes Made
  - [file] — description of change

  ## Files Modified
  - path/to/file1.js
  - path/to/file2.js
  ```

### Stage 3: Code Review

Spawn the `code-reviewer` agent on all modified files:
- Input: the files listed in `02-changes.md`
- Output: `$PIPELINE_DIR/03-review.md`

If review returns **NEEDS CHANGES**:
- Fix the issues identified by the reviewer
- Append fixes to `02-changes.md`
- Re-run review (max 2 review cycles)

### Stage 4: QA

Spawn the `qa` agent on all modified files:
- Input: the files listed in `02-changes.md`
- Output: `$PIPELINE_DIR/04-qa.md`

If tests **FAIL**:
- Fix the failing tests or the code causing failures
- Re-run QA (max 2 QA cycles)

### Stage 5: Verify

Run local verification checks (build, lint, console.log audit):

```bash
# Build check — detect build system from project
# SvelteKit/Vite: npx vite build
# Next.js: npx next build
# Plain HTML: skip build
# Node/Express: node -c <entry file>
# Use whatever build command the project uses

# Git status
git status --porcelain

# Console.log audit on modified files
git diff --name-only HEAD | xargs grep -l "console.log" 2>/dev/null
```

Write results to `$PIPELINE_DIR/05-verify.md`

## Final Verdict

After all stages complete, write the final verdict to `$PIPELINE_DIR/VERDICT.md`:

```
# Pipeline Verdict

**Mode:** <feature|bugfix|refactor>
**Description:** <what was done>
**Duration:** <start to end>

## Stage Results
| Stage | Status | Notes |
|---|---|---|
| Plan/Diagnose | ✅/❌ | ... |
| Implement | ✅/❌ | ... |
| Code Review | ✅/❌ | ... |
| QA | ✅/❌ | ... |
| Verify | ✅/❌ | ... |

## Files Changed
- file1.js
- file2.js

## Verdict: SHIP / NEEDS WORK / BLOCKED

## Next Steps (if NEEDS WORK or BLOCKED)
- What remains to be done
```

### Verdict Criteria

| Verdict | When |
|---|---|
| **SHIP** | All stages pass. Build succeeds. Tests pass. Review clean. |
| **NEEDS WORK** | Review or QA found issues after max retry cycles. Changes are safe but incomplete. |
| **BLOCKED** | Build fails and can't be auto-fixed. Missing dependencies. Architectural question needs human input. |

## Important

- Each stage is sequential — don't skip ahead
- All output goes to `.claude/pipeline/` for traceability
- If any stage is BLOCKED, stop the pipeline and report — don't keep going
- The parent agent (you) does all code changes — subagents are read-only reporters
- Max 2 retry cycles per review/QA stage to prevent infinite loops
- Clean up old pipeline directories periodically (keep last 5)
