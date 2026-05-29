/**
 * Debug logging utility
 * Logs only when DEBUG environment variable is set
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const debug = {
  log: (...args) => {
    if (DEBUG) console.log('[DEBUG]', ...args);
  },
  warn: (...args) => {
    if (DEBUG) console.warn('[DEBUG]', ...args);
  },
};

module.exports = debug;
