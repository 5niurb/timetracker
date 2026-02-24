#!/usr/bin/env node
/**
 * Strategic Compact Suggester (Node.js port)
 *
 * Runs on PreToolUse (Edit/Write) and suggests manual /compact at logical intervals.
 * Tracks tool call count per session using a temp file.
 *
 * Hook config:
 * { "matcher": "Edit|Write", "hooks": [{ "type": "command",
 *   "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/strategic-compact/suggest-compact.mjs\"" }] }
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const sessionId = process.env.CLAUDE_SESSION_ID || process.env.PPID || 'default';
const counterFile = join(tmpdir(), `claude-tool-count-${sessionId}`);
const threshold = parseInt(process.env.COMPACT_THRESHOLD || '50', 10);

let count = 1;
if (existsSync(counterFile)) {
	count = parseInt(readFileSync(counterFile, 'utf8').trim(), 10) + 1;
}
writeFileSync(counterFile, String(count));

if (count === threshold) {
	console.error(`[StrategicCompact] ${threshold} tool calls reached — consider /compact if transitioning phases`);
}

if (count > threshold && count % 25 === 0) {
	console.error(`[StrategicCompact] ${count} tool calls — good checkpoint for /compact if context is stale`);
}
