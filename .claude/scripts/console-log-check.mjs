#!/usr/bin/env node
/**
 * Stop hook: Scans git-modified files for console.log statements.
 * Warns (stderr) but does NOT block (exit 0). Just a heads-up before session ends.
 *
 * Only checks staged + unstaged changes in tracked files (.js, .svelte, .ts).
 * Ignores: node_modules, .min. files, test files, api/services/ (logging is intentional there).
 */
import { execSync } from 'child_process';

const IGNORE_PATTERNS = [
  'node_modules',
  '.min.',
  '.test.',
  '.spec.',
  '__tests__',
  'api/services/', // service clients often have intentional logging
  'scripts/',      // utility scripts can log
  'seed.sql',
];

try {
  // Get modified files (staged + unstaged)
  const diff = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  const staged = execSync('git diff --cached --name-only', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  const allFiles = [...new Set([...diff.split('\n'), ...staged.split('\n')])]
    .filter(f => f && /\.(js|svelte|ts|mjs)$/.test(f))
    .filter(f => !IGNORE_PATTERNS.some(p => f.includes(p)));

  if (allFiles.length === 0) process.exit(0);

  const hits = [];

  for (const file of allFiles) {
    try {
      const content = execSync(`git diff HEAD -- "${file}" 2>/dev/null || git diff -- "${file}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Only check added lines (lines starting with +)
      const addedLines = content.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));

      for (const line of addedLines) {
        if (/console\.(log|debug|info)\s*\(/.test(line)) {
          hits.push({ file, line: line.substring(1).trim() });
        }
      }
    } catch {
      // File might be new/untracked — skip
    }
  }

  if (hits.length > 0) {
    console.error(`\n⚠️  Found ${hits.length} console.log statement(s) in modified files:`);
    for (const h of hits) {
      console.error(`  ${h.file}: ${h.line.substring(0, 80)}`);
    }
    console.error('  Consider removing before deploying.\n');
  }
} catch {
  // Not in a git repo or git not available — skip silently
}

process.exit(0); // Never block — just warn
