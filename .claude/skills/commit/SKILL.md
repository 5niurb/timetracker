---
name: commit
description: Stage, commit, and push changes to GitHub with a formatted commit message
disable-model-invocation: true
---

# Commit Skill

Stage changes, create a properly formatted commit, and push to GitHub.

## Current State
- Branch: !`git branch --show-current`
- Status: !`git status --short`

## Instructions

1. **Review changes** using `git status` and `git diff --stat`
2. **Stage relevant files** — avoid `git add -A`, stage specific files
3. **Create commit** with formatted message:

```
[area] Brief description (imperative mood)

- Detail 1
- Detail 2

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

Areas: `[admin]`, `[employee]`, `[api]`, `[config]`, `[fix]`, `[style]`

4. **Push to origin main**

## Arguments
If `$ARGUMENTS` is provided, use it as guidance for the commit message scope.

## Never Commit
- `.env` files
- `node_modules/`
- Secrets or credentials
