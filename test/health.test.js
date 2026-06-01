'use strict';

const assert = require('assert');
const { buildHealth } = require('../lib/health');

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log('  PASS:', name); passed++; })
    .catch((e) => { console.error('  FAIL:', name, '-', e.message); failed++; });
}

(async () => {
  console.log('Health report builder:');

  await test('liveness (deep=false) is ok, 200, no supabase key', async () => {
    const { health, httpStatus } = await buildHealth({ deep: false, uptime: 5, version: '1.2.3' });
    assert.equal(health.status, 'ok');
    assert.equal(httpStatus, 200);
    assert.equal(health.supabase, undefined);
    assert.equal(health.uptime, 5);
    assert.equal(health.version, '1.2.3');
  });

  await test('deep + healthy probe → ok, 200, supabase:ok', async () => {
    const probe = async () => ({ error: null });
    const { health, httpStatus } = await buildHealth({ deep: true, probe });
    assert.equal(health.status, 'ok');
    assert.equal(httpStatus, 200);
    assert.equal(health.supabase, 'ok');
  });

  await test('deep + probe returns error → degraded, 503', async () => {
    const probe = async () => ({ error: { message: 'db down' } });
    const { health, httpStatus } = await buildHealth({ deep: true, probe });
    assert.equal(health.status, 'degraded');
    assert.equal(httpStatus, 503);
    assert.equal(health.supabase, 'error');
  });

  await test('deep + probe throws → degraded, 503, error captured', async () => {
    const probe = async () => { throw new Error('connection refused'); };
    const { health, httpStatus } = await buildHealth({ deep: true, probe });
    assert.equal(health.status, 'degraded');
    assert.equal(httpStatus, 503);
    assert.equal(health.supabase, 'error');
    assert.equal(health.supabaseError, 'connection refused');
  });

  await test('deep + probe hangs past timeout → degraded (timeout)', async () => {
    const probe = () => new Promise(() => {}); // never resolves
    const { health, httpStatus } = await buildHealth({ deep: true, probe, timeoutMs: 50 });
    assert.equal(health.status, 'degraded');
    assert.equal(httpStatus, 503);
    assert.match(health.supabaseError, /timeout/);
  });

  await test('deep=true but no probe given → ok (no supabase field)', async () => {
    const { health } = await buildHealth({ deep: true, probe: null });
    assert.equal(health.status, 'ok');
    assert.equal(health.supabase, undefined);
  });

  console.log(`\nHealth: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
