---
name: strategic-compact
description: Suggests manual /compact at logical workflow intervals. Includes a hook that counts tool calls and reminds at thresholds.
---

# Strategic Compact

Suggests manual `/compact` at strategic points rather than relying on arbitrary auto-compaction.

## When to Activate

- Long sessions approaching context limits
- Multi-phase tasks (research → plan → implement → test)
- Switching between unrelated tasks
- After completing a major milestone
- When responses slow down or become less coherent

## Compaction Decision Guide

| Phase Transition | Compact? | Why |
|---|---|---|
| Research → Planning | **Yes** | Research context is bulky; plan is the distilled output |
| Planning → Implementation | **Yes** | Plan is in TodoWrite or a file; free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code |
| Debugging → Next feature | **Yes** | Debug traces pollute context for unrelated work |
| Mid-implementation | **No** | Losing variable names, file paths, partial state is costly |
| After a failed approach | **Yes** | Clear dead-end reasoning before trying new approach |

## What Survives Compaction

| Persists | Lost |
|---|---|
| CLAUDE.md instructions | Intermediate reasoning |
| TodoWrite task list | File contents you previously read |
| Memory files | Multi-step conversation context |
| Git state | Tool call history |
| Files on disk | Nuanced verbal preferences |

## Hook Setup

The `suggest-compact.mjs` script runs on PreToolUse (Edit/Write) and:
1. Tracks tool call count per session
2. Suggests at configurable threshold (default: 50 calls)
3. Reminds every 25 calls after threshold

## Best Practices

1. **Compact after planning** — Plan finalized in TodoWrite? Compact and start fresh
2. **Compact after debugging** — Root cause found and fixed? Clear the debug context
3. **Don't compact mid-implementation** — Preserve context for related changes
4. **Write before compacting** — Save important context to files or SESSION_NOTES.md
5. **Use /compact with a summary** — `/compact Focus on implementing auth middleware next`
