---
name: checkpoint
description: Git-backed checkpoints for safe experimentation. Create named save points, list history, and restore to any previous checkpoint.
argument-hint: create [message] | list | restore <sha>
disable-model-invocation: false
allowed-tools: Bash, Read
---

# Git Checkpoint Manager

Lightweight git-backed save points for safe experimentation. Cheaper than branches — just SHA bookmarks with labels.

## Arguments

Parse the command from: $ARGUMENTS

| Command | Action |
|---|---|
| `create [message]` | Save current state as a checkpoint |
| `list` | Show checkpoint history |
| `restore <sha>` | Restore to a specific checkpoint |
| *(empty)* | Default to `create` with auto-generated message |

## Commands

### `create [message]`

1. **Stage and commit everything** (if there are uncommitted changes):
   ```bash
   git add -A
   git commit -m "[checkpoint] <message or auto-generated>"
   ```
   - If no changes exist, use the current HEAD commit

2. **Log the checkpoint:**
   ```bash
   SHA=$(git rev-parse HEAD)
   TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
   echo "$TIMESTAMP | $SHA | <message>" >> .claude/checkpoints.log
   ```

3. **Report:**
   ```
   Checkpoint saved: <sha_short> — <message>
   Restore with: /checkpoint restore <sha_short>
   ```

### `list`

1. **Read the checkpoint log:**
   ```bash
   cat .claude/checkpoints.log
   ```

2. **Display as a table:**
   ```
   | # | Time | SHA | Message |
   |---|------|-----|---------|
   | 1 | 2026-02-22 14:30 | a1b2c3d | Before refactoring auth |
   | 2 | 2026-02-22 15:15 | e4f5g6h | After adding validation |
   ```

   If no checkpoints exist, say so.

### `restore <sha>`

1. **Safety check** — warn if there are uncommitted changes:
   ```bash
   git status --porcelain
   ```
   If dirty, **auto-create a checkpoint** of current state first (so nothing is lost).

2. **Restore:**
   ```bash
   git checkout <sha> -- .
   ```
   This restores the working tree to that checkpoint WITHOUT moving HEAD or changing branch.

3. **Log the restore:**
   ```bash
   echo "$(date '+%Y-%m-%d %H:%M:%S') | RESTORED from $SHA" >> .claude/checkpoints.log
   ```

4. **Report:**
   ```
   Restored to checkpoint <sha_short> — <original message>
   Current branch unchanged. Changes are unstaged.
   Review with: git diff --stat
   ```

## Important

- Checkpoints are local-only — they don't push to remote
- The log file `.claude/checkpoints.log` tracks all checkpoints and restores
- Restoring doesn't change your branch — it just overwrites the working tree
- Always auto-checkpoint before restore so you can undo the undo
- The `.claude/` directory should be in `.gitignore` — checkpoints.log won't pollute the repo
