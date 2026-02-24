#!/usr/bin/env node
/**
 * Continuous Learning v2 — Observation Hook (Node.js port)
 *
 * Captures tool use events for pattern analysis.
 * Claude Code passes hook data via stdin as JSON.
 *
 * Hook config (in .claude/settings.json):
 * {
 *   "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command",
 *     "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/continuous-learning-v2/hooks/observe.mjs\" pre" }] }],
 *   "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command",
 *     "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/continuous-learning-v2/hooks/observe.mjs\" post" }] }]
 * }
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.claude', 'homunculus');
const OBSERVATIONS_FILE = join(CONFIG_DIR, 'observations.jsonl');
const MAX_FILE_SIZE_MB = 10;

// Ensure directory exists
mkdirSync(CONFIG_DIR, { recursive: true });

// Skip if disabled
if (existsSync(join(CONFIG_DIR, 'disabled'))) process.exit(0);

// Read JSON from stdin
let inputJson = '';
try {
	inputJson = readFileSync(0, 'utf8').trim();
} catch {
	process.exit(0);
}

if (!inputJson) process.exit(0);

let parsed;
try {
	const data = JSON.parse(inputJson);

	const hookType = data.hook_type || 'unknown';
	const toolName = data.tool_name || data.tool || 'unknown';
	let toolInput = data.tool_input || data.input || {};
	let toolOutput = data.tool_output || data.output || '';
	const sessionId = data.session_id || 'unknown';

	// Truncate large inputs/outputs
	const inputStr =
		typeof toolInput === 'object' ? JSON.stringify(toolInput).slice(0, 5000) : String(toolInput).slice(0, 5000);
	const outputStr =
		typeof toolOutput === 'object'
			? JSON.stringify(toolOutput).slice(0, 5000)
			: String(toolOutput).slice(0, 5000);

	const event = hookType.includes('Pre') ? 'tool_start' : 'tool_complete';

	parsed = {
		event,
		tool: toolName,
		input: event === 'tool_start' ? inputStr : undefined,
		output: event === 'tool_complete' ? outputStr : undefined,
		session: sessionId,
	};
} catch (e) {
	// Log parse error for debugging
	const timestamp = new Date().toISOString();
	const errorEntry = JSON.stringify({ timestamp, event: 'parse_error', raw: inputJson.slice(0, 2000) });
	appendFileSync(OBSERVATIONS_FILE, errorEntry + '\n');
	process.exit(0);
}

// Archive if file too large
if (existsSync(OBSERVATIONS_FILE)) {
	try {
		const stats = statSync(OBSERVATIONS_FILE);
		const sizeMB = stats.size / (1024 * 1024);
		if (sizeMB >= MAX_FILE_SIZE_MB) {
			const archiveDir = join(CONFIG_DIR, 'observations.archive');
			mkdirSync(archiveDir, { recursive: true });
			const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			renameSync(OBSERVATIONS_FILE, join(archiveDir, `observations-${ts}.jsonl`));
		}
	} catch {
		/* ignore stat/rename errors */
	}
}

// Build and write observation
const observation = {
	timestamp: new Date().toISOString(),
	event: parsed.event,
	tool: parsed.tool,
	session: parsed.session,
};

if (parsed.input) observation.input = parsed.input;
if (parsed.output) observation.output = parsed.output;

appendFileSync(OBSERVATIONS_FILE, JSON.stringify(observation) + '\n');
