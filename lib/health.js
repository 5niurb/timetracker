'use strict';

// Pure, testable health-report builder. Kept separate from server.js so the
// deep-vs-liveness + degraded logic can be unit-tested without booting Express
// or hitting Supabase.
//
// probe: optional async () => ({ error }) — a Supabase connectivity check.
//        Wrapped in a timeout so a hung DB can't hang the health response.
// opts:  { deep (bool), timeoutMs (default 3000), version, uptime, now }

async function buildHealth({ deep = true, probe = null, timeoutMs = 3000, version = '1.0.0', uptime = 0, now = () => new Date() } = {}) {
  const health = {
    status: 'ok',
    uptime,
    timestamp: now().toISOString(),
    version,
  };

  if (deep && probe) {
    let timerId;
    try {
      const timeout = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('supabase probe timeout')), timeoutMs);
      });
      const { error } = await Promise.race([probe(), timeout]);
      health.supabase = error ? 'error' : 'ok';
      if (error) health.status = 'degraded';
    } catch (err) {
      health.supabase = 'error';
      health.status = 'degraded';
      health.supabaseError = err.message;
    } finally {
      clearTimeout(timerId);
    }
  }

  const httpStatus = health.status === 'ok' ? 200 : 503;
  return { health, httpStatus };
}

module.exports = { buildHealth };
