#!/usr/bin/env node

/**
 * Cleanup build artifacts before Node.js builds
 *
 * Removes:
 * - npm cache (.npm/)
 * - Build output (dist/, build/)
 * - Node build artifacts (node_modules/.cache/)
 *
 * This is safe to run frequently — all artifacts are auto-regenerated on next build.
 * Runs automatically via npm prebuild hook before `npm start`, `npm run build`, etc.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = __dirname.replace('/scripts', '');

const ARTIFACTS_TO_CLEAN = [
	'.npm',
	'dist',
	'build',
	'node_modules/.cache',
];

function removeArtifact(relativePath) {
	const fullPath = path.join(projectRoot, relativePath);

	try {
		if (fs.existsSync(fullPath)) {
			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				fs.rmSync(fullPath, { recursive: true, force: true });
			} else {
				fs.unlinkSync(fullPath);
			}
			console.log(`✓ Removed: ${relativePath}`);
		}
	} catch (err) {
		console.error(`✗ Failed to remove ${relativePath}: ${err.message}`);
	}
}

console.log('🧹 Cleaning up Node.js build artifacts...\n');

ARTIFACTS_TO_CLEAN.forEach((artifact) => removeArtifact(artifact));

console.log('\n✅ Cleanup complete. Ready for build.');
