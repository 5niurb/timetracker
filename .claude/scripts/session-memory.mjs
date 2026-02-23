#!/usr/bin/env node
/**
 * Session memory persistence script. Called by multiple hooks:
 *
 *   --save     (Stop / PreCompact) — saves current session state
 *   --load     (SessionStart)      — loads previous session context, prints to stdout
 *
 * Storage: ~/.claude/session-memory/<project-slug>-<date>.json
 * Keeps last 5 memory files per project (auto-prunes older ones).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const MEMORY_DIR = join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude',
  'session-memory'
);
const MAX_FILES = 5;
const action = process.argv[2]; // --save or --load

if (!action || !['--save', '--load'].includes(action)) {
  console.error('Usage: session-memory.mjs --save | --load');
  process.exit(0);
}

// Ensure directory exists
if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });

// Derive project slug from cwd
function getProjectSlug() {
  const cwd = process.cwd().replace(/\\/g, '/');
  const parts = cwd.split('/');
  return parts[parts.length - 1] || 'unknown';
}

function getDate() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getProjectFiles() {
  const slug = getProjectSlug();
  return readdirSync(MEMORY_DIR)
    .filter(f => f.startsWith(slug + '-') && f.endsWith('.json'))
    .sort()
    .map(f => join(MEMORY_DIR, f));
}

if (action === '--save') {
  const slug = getProjectSlug();
  const date = getDate();
  const filepath = join(MEMORY_DIR, `${slug}-${date}.json`);

  // Gather state
  const state = {
    timestamp: new Date().toISOString(),
    project: slug,
    cwd: process.cwd(),
  };

  // Git branch + recent commits
  try {
    state.branch = execSync('git branch --show-current', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    state.recentCommits = execSync('git log --oneline -5', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    state.modifiedFiles = execSync('git diff --name-only HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    state.stagedFiles = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* not a git repo */ }

  // Read SESSION_NOTES.md last 50 lines for context
  const sessionNotes = join(process.cwd(), 'SESSION_NOTES.md');
  if (existsSync(sessionNotes)) {
    const content = readFileSync(sessionNotes, 'utf8');
    const lines = content.split('\n');
    state.sessionNotesExcerpt = lines.slice(-50).join('\n');
  }

  writeFileSync(filepath, JSON.stringify(state, null, 2));

  // Prune old files
  const files = getProjectFiles();
  if (files.length > MAX_FILES) {
    for (const old of files.slice(0, files.length - MAX_FILES)) {
      try { unlinkSync(old); } catch { /* ignore */ }
    }
  }

  console.error(`Session memory saved: ${basename(filepath)}`);
}

if (action === '--load') {
  const files = getProjectFiles();
  if (files.length === 0) {
    console.log('No previous session memory found.');
    process.exit(0);
  }

  const latest = files[files.length - 1];
  try {
    const state = JSON.parse(readFileSync(latest, 'utf8'));
    const parts = [];

    parts.push(`Previous session: ${state.timestamp}`);
    if (state.branch) parts.push(`Branch: ${state.branch}`);
    if (state.recentCommits) parts.push(`Recent commits:\n${state.recentCommits}`);
    if (state.modifiedFiles) parts.push(`Uncommitted changes:\n${state.modifiedFiles}`);
    if (state.sessionNotesExcerpt) {
      // Just the last session header
      const excerpt = state.sessionNotesExcerpt;
      const lastSession = excerpt.split(/^## Session/m).pop();
      if (lastSession) parts.push(`Last session notes:\n## Session${lastSession.substring(0, 500)}`);
    }

    console.log(parts.join('\n\n'));
  } catch {
    console.log('Could not load previous session memory.');
  }
}

process.exit(0);
