---
name: continuous-learning-v2
description: Instinct-based learning system. Observes sessions via hooks, creates atomic instincts with confidence scoring, and can evolve them into skills/agents.
---

# Continuous Learning v2 — Instinct-Based

Turns Claude Code sessions into reusable knowledge through atomic "instincts" — small learned behaviors with confidence scoring.

## How It Works

```
Session Activity
      │
      │ Hooks capture tool use (PreToolUse/PostToolUse)
      ▼
~/.claude/homunculus/observations.jsonl
      │
      │ /instinct-status, /evolve commands analyze patterns
      ▼
~/.claude/homunculus/instincts/personal/
      │
      │ Clusters evolve into
      ▼
~/.claude/homunculus/evolved/{skills,commands,agents}/
```

## The Instinct Model

An instinct is a small learned behavior:
- **Atomic** — one trigger, one action
- **Confidence-weighted** — 0.3 (tentative) to 0.9 (near certain)
- **Domain-tagged** — code-style, testing, git, debugging, workflow
- **Evidence-backed** — tracks observations that created it

## Directory Structure

```
~/.claude/homunculus/
├── observations.jsonl       # Session observations (auto-captured)
├── observations.archive/    # Archived observations
├── instincts/
│   ├── personal/            # Auto-learned instincts
│   └── inherited/           # Imported from others
└── evolved/
    ├── skills/              # Generated skills
    ├── commands/            # Generated commands
    └── agents/              # Generated agents
```

## Commands

| Command | Description |
|---|---|
| `/instinct-status` | Show all instincts with confidence scores |
| `/evolve` | Cluster related instincts into skills/commands |
| `/instinct-export` | Export instincts for sharing |
| `/instinct-import <file>` | Import instincts from others |

## Hook Setup

Observation hooks are configured in project `.claude/settings.json` or global `settings.local.json`. They capture every tool call to `observations.jsonl` for later pattern analysis.

The observe hook (`observe.mjs`) runs on PreToolUse and PostToolUse with matcher `*`, capturing tool name, truncated input/output, and timestamp.

## Confidence Scoring

| Score | Meaning | Behavior |
|---|---|---|
| 0.3 | Tentative | Suggested but not enforced |
| 0.5 | Moderate | Applied when relevant |
| 0.7 | Strong | Auto-approved for application |
| 0.9 | Near-certain | Core behavior |

Confidence increases with repeated observations, decreases with contradictions or time decay.

## Pattern Detection

The system watches for:
1. **User corrections** — "No, use X instead of Y" → instinct
2. **Error resolutions** — Error followed by fix → instinct
3. **Repeated workflows** — Same tool sequence used multiple times → instinct
4. **Tool preferences** — Consistently preferring certain tools → instinct

## Privacy

- Observations stay local on your machine
- Only instincts (patterns) can be exported — no code or conversation content
- You control what gets exported

## Learnings

- Ported from Python to Node.js (Python not available on this machine)
- Hook uses `$CLAUDE_PROJECT_DIR` for portability across projects
- Observations truncated to 5000 chars to prevent file bloat
- Archive triggers at 10MB to prevent disk issues
