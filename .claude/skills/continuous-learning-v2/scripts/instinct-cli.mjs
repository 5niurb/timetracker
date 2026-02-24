#!/usr/bin/env node
/**
 * Instinct CLI — Manage instincts for Continuous Learning v2 (Node.js port)
 *
 * Commands:
 *   status   - Show all instincts and their status
 *   export   - Export instincts to stdout or file
 *   evolve   - Cluster instincts and suggest evolutions
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';

const HOMUNCULUS_DIR = join(homedir(), '.claude', 'homunculus');
const PERSONAL_DIR = join(HOMUNCULUS_DIR, 'instincts', 'personal');
const INHERITED_DIR = join(HOMUNCULUS_DIR, 'instincts', 'inherited');
const OBSERVATIONS_FILE = join(HOMUNCULUS_DIR, 'observations.jsonl');

// Ensure dirs exist
for (const d of [PERSONAL_DIR, INHERITED_DIR]) {
	mkdirSync(d, { recursive: true });
}

function parseInstinctFile(content) {
	const instincts = [];
	let current = {};
	let inFrontmatter = false;
	let contentLines = [];

	for (const line of content.split('\n')) {
		if (line.trim() === '---') {
			if (inFrontmatter) {
				inFrontmatter = false;
			} else {
				inFrontmatter = true;
				if (current.id) {
					current.content = contentLines.join('\n').trim();
					instincts.push(current);
				}
				current = {};
				contentLines = [];
			}
		} else if (inFrontmatter) {
			const colonIdx = line.indexOf(':');
			if (colonIdx > 0) {
				const key = line.slice(0, colonIdx).trim();
				let value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
				if (key === 'confidence') value = parseFloat(value);
				current[key] = value;
			}
		} else {
			contentLines.push(line);
		}
	}

	if (current.id) {
		current.content = contentLines.join('\n').trim();
		instincts.push(current);
	}

	return instincts.filter((i) => i.id);
}

function loadAllInstincts() {
	const instincts = [];
	for (const [dir, sourceType] of [
		[PERSONAL_DIR, 'personal'],
		[INHERITED_DIR, 'inherited'],
	]) {
		if (!existsSync(dir)) continue;
		const files = readdirSync(dir).filter((f) => /\.(md|yaml|yml)$/.test(f));
		for (const file of files.sort()) {
			try {
				const content = readFileSync(join(dir, file), 'utf8');
				const parsed = parseInstinctFile(content);
				for (const inst of parsed) {
					inst._source_file = join(dir, file);
					inst._source_type = sourceType;
				}
				instincts.push(...parsed);
			} catch (e) {
				console.error(`Warning: Failed to parse ${file}: ${e.message}`);
			}
		}
	}
	return instincts;
}

function cmdStatus() {
	const instincts = loadAllInstincts();

	if (!instincts.length) {
		console.log('No instincts found.');
		console.log(`\nInstinct directories:`);
		console.log(`  Personal:  ${PERSONAL_DIR}`);
		console.log(`  Inherited: ${INHERITED_DIR}`);
		return;
	}

	// Group by domain
	const byDomain = {};
	for (const inst of instincts) {
		const domain = inst.domain || 'general';
		if (!byDomain[domain]) byDomain[domain] = [];
		byDomain[domain].push(inst);
	}

	const personal = instincts.filter((i) => i._source_type === 'personal');
	const inherited = instincts.filter((i) => i._source_type === 'inherited');

	console.log(`\n${'='.repeat(60)}`);
	console.log(`  INSTINCT STATUS - ${instincts.length} total`);
	console.log(`${'='.repeat(60)}\n`);
	console.log(`  Personal:  ${personal.length}`);
	console.log(`  Inherited: ${inherited.length}\n`);

	for (const domain of Object.keys(byDomain).sort()) {
		const items = byDomain[domain].sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5));
		console.log(`## ${domain.toUpperCase()} (${items.length})\n`);

		for (const inst of items) {
			const conf = inst.confidence || 0.5;
			const filled = Math.round(conf * 10);
			const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
			console.log(`  ${bar} ${Math.round(conf * 100).toString().padStart(3)}%  ${inst.id}`);
			if (inst.trigger) console.log(`            trigger: ${inst.trigger}`);

			const actionMatch = (inst.content || '').match(/## Action\s*\n\s*(.+?)(?:\n\n|\n##|$)/s);
			if (actionMatch) {
				const action = actionMatch[1].trim().split('\n')[0];
				console.log(`            action: ${action.slice(0, 60)}${action.length > 60 ? '...' : ''}`);
			}
			console.log();
		}
	}

	// Observation stats
	if (existsSync(OBSERVATIONS_FILE)) {
		const content = readFileSync(OBSERVATIONS_FILE, 'utf8');
		const lines = content.trim().split('\n').filter(Boolean);
		console.log(`${'─'.repeat(60)}`);
		console.log(`  Observations: ${lines.length} events logged`);
		console.log(`  File: ${OBSERVATIONS_FILE}`);
	}

	console.log(`\n${'='.repeat(60)}\n`);
}

function cmdExport() {
	const instincts = loadAllInstincts();
	if (!instincts.length) {
		console.log('No instincts to export.');
		return;
	}

	let output = `# Instincts export\n# Date: ${new Date().toISOString()}\n# Total: ${instincts.length}\n\n`;
	for (const inst of instincts) {
		output += '---\n';
		for (const key of ['id', 'trigger', 'confidence', 'domain', 'source']) {
			if (inst[key] != null) {
				output += key === 'trigger' ? `${key}: "${inst[key]}"\n` : `${key}: ${inst[key]}\n`;
			}
		}
		output += '---\n\n';
		output += (inst.content || '') + '\n\n';
	}
	console.log(output);
}

function cmdEvolve() {
	const instincts = loadAllInstincts();
	if (instincts.length < 3) {
		console.log(`Need at least 3 instincts to analyze. Currently have: ${instincts.length}`);
		return;
	}

	console.log(`\n${'='.repeat(60)}`);
	console.log(`  EVOLVE ANALYSIS - ${instincts.length} instincts`);
	console.log(`${'='.repeat(60)}\n`);

	const highConf = instincts.filter((i) => (i.confidence || 0) >= 0.8);
	console.log(`High confidence instincts (>=80%): ${highConf.length}`);

	// Cluster by similar triggers
	const clusters = {};
	for (const inst of instincts) {
		const key = (inst.trigger || '')
			.toLowerCase()
			.replace(/\b(when|creating|writing|adding|implementing|testing)\b/g, '')
			.trim();
		if (!clusters[key]) clusters[key] = [];
		clusters[key].push(inst);
	}

	const skillCandidates = Object.entries(clusters)
		.filter(([, items]) => items.length >= 2)
		.map(([trigger, items]) => ({
			trigger,
			instincts: items,
			avgConfidence: items.reduce((sum, i) => sum + (i.confidence || 0.5), 0) / items.length,
			domains: [...new Set(items.map((i) => i.domain || 'general'))],
		}))
		.sort((a, b) => b.instincts.length - a.instincts.length || b.avgConfidence - a.avgConfidence);

	if (skillCandidates.length) {
		console.log(`\n## SKILL CANDIDATES\n`);
		for (const [i, cand] of skillCandidates.slice(0, 5).entries()) {
			console.log(`${i + 1}. Cluster: "${cand.trigger}"`);
			console.log(`   Instincts: ${cand.instincts.length}`);
			console.log(`   Avg confidence: ${Math.round(cand.avgConfidence * 100)}%`);
			console.log(`   Domains: ${cand.domains.join(', ')}`);
			for (const inst of cand.instincts.slice(0, 3)) {
				console.log(`     - ${inst.id}`);
			}
			console.log();
		}
	}

	console.log(`\n${'='.repeat(60)}\n`);
}

// Main
const command = process.argv[2];
switch (command) {
	case 'status':
		cmdStatus();
		break;
	case 'export':
		cmdExport();
		break;
	case 'evolve':
		cmdEvolve();
		break;
	default:
		console.log('Usage: node instinct-cli.mjs <status|export|evolve>');
		process.exit(1);
}
