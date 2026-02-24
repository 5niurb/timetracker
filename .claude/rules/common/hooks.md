# Hooks System

## Active Hooks (per-project in `.claude/settings.json`)

| Hook | Type | Purpose |
|------|------|---------|
| session-memory --load | SessionStart | Loads previous session state |
| cloud-setup.sh | SessionStart | Installs prettier in cloud VMs |
| .env blocker | PreToolUse (Edit/Write) | Blocks edits to sensitive files (exit 2) |
| prettier | PostToolUse (Edit/Write) | Auto-formats HTML/CSS/JS/JSON/MD/Svelte |
| ci-check | PostToolUse (Bash) | After `git push`: polls GitHub Actions, reports pass/fail |
| console-log-check | Stop | Warns about `console.log` in modified files |
| session-memory --save | Stop | Persists session state before exit |

Project-specific:
- **lm-app**: `build-check` (PostToolUse) — runs `svelte-check` after .svelte edits

## Global Hooks (`~/.claude/settings.local.json`)

| Hook | Type | Purpose |
|------|------|---------|
| observe pre | PreToolUse (*) | Logs every tool start to `~/.claude/homunculus/observations.jsonl` |
| observe post | PostToolUse (*) | Logs every tool completion to observations |
| suggest-compact | PreToolUse (Edit/Write) | Counts edits, suggests `/compact` at 50 calls (then every 25) |

These are also wired per-project using `$CLAUDE_PROJECT_DIR` paths for portability.

## Hook Architecture

All project hooks use portable `$CLAUDE_PROJECT_DIR` paths so they work across machines and in cloud VMs. Scripts live in each project's `.claude/scripts/` directory.

Global `~/.claude/settings.local.json` has fallback copies for repos without project-level config, plus workspace-level hooks (observe, suggest-compact) with hardcoded paths.

## Self-Annealing

When a hook or script breaks:
1. Fix the script and test it
2. Update the SKILL.md or script comments with what was learned
3. The system gets stronger — errors become documentation

## TodoWrite Usage

Use TodoWrite to:
- Track progress on multi-step tasks
- Show granular implementation steps
- Enable real-time steering on complex work
