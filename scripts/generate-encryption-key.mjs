#!/usr/bin/env node
/**
 * One-time script to generate a PAYTRACK_ENCRYPTION_KEY value.
 * Run: node scripts/generate-encryption-key.mjs
 * Copy the output to:
 *   1. Render env var: PAYTRACK_ENCRYPTION_KEY
 *   2. Local timetracker/.env for dev
 * DO NOT commit the key to git.
 */

import { randomBytes } from 'crypto';

const key = randomBytes(32).toString('base64');
console.log(key);
