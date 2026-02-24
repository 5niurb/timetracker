# Performance Optimization

## Model Routing for Subagents

Use the cheapest model that handles the task well. Parent agent (Opus) orchestrates.

| Task | Model | Why |
|------|-------|-----|
| File exploration, codebase search | **Haiku** | Fast, cheap, search doesn't need deep reasoning |
| Simple single-file reads | **Haiku** | Just reading + summarizing |
| Code review | **Sonnet** | Needs judgment but not architectural reasoning |
| QA / test generation | **Sonnet** | Needs to understand code patterns |
| Multi-file implementation | **Sonnet** | Balanced cost/quality for writing code |
| Database review | **Sonnet** | Pattern matching against known anti-patterns |
| Architecture decisions | **Opus** | Complex trade-offs, system-wide reasoning |
| Security analysis | **Opus** | High stakes, needs thorough analysis |
| Documentation generation | **Haiku** | Mostly templated output |

Pass `model` parameter explicitly when spawning subagents:
```
Task(subagent_type="Explore", model="haiku", ...)
Task(subagent_type="research", model="sonnet", ...)
```

This yields ~60-70% cost reduction with negligible quality loss.

## Context Window Management

### When to Compact
- After research/exploration (summarize, then compact before implementation)
- After completing a milestone (feature done, tests pass)
- After debugging (root cause found, fix applied)
- When context feels sluggish (slow tool calls, repeated context)

### When NOT to Compact
- Mid-implementation (variable names, file paths, partial state will be lost)
- During multi-file refactoring (need awareness of all files)
- While debugging (error context, stack traces, hypotheses in memory)
- Right before a deploy (keep full context of what changed)

## Build Troubleshooting

If build fails:
1. Use **build-error-resolver** agent (minimal-diff fixes only)
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix
