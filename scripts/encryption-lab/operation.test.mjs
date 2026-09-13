import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncryptionOperation } from './operation.mjs';

const time = 1_800_000_000_000;
function evidence() {
  return {
    serial: 'UTF54M000145', model: 'XT2145', os: '9.1.93.2', mount: '/storage/sd',
    format: false, apiAvailable: true, filesystemType: 'exfat',
    priorKeyState: 'verified-absent', attemptState: 'verified-absent',
    mediaIdle: true, otaIdle: true, mediaPaused: true, otaReachable: true,
    observedAt: time, authenticatedHeartbeatTimes: [time - 60_000, time],
    candidateSha256: 'a'.repeat(64), packageGateSha256: 'a'.repeat(64),
    recovery: { registryReadback: true, endpointReachable: true, safeVersion: '1.5.23', packageChecksumVerified: true },
    remountRecoveryProof: { reviewed: true, report: 'SYNTHETIC ONLY', model: 'XT2145',
      os: '9.1.93.2', candidateSha256: 'a'.repeat(64), survivesSdUnavailable: true,
      unattendedRecoveryObserved: true },
  };
}
function setup(overrides = {}) {
  const calls = [];
  const run = createEncryptionOperation({ observe: async () => evidence(),
    claimAttempt: async () => true, now: () => time,
    encryptstorage: async (...args) => calls.push(args), ...overrides });
  return { calls, run };
}
test('exact documented arguments; API resolution is not completion', async () => {
  const f = setup();
  assert.equal((await f.run()).state, 'api-returned-verification-required');
  assert.deepEqual(f.calls, [['/storage/sd', { method: 'generate key', format: false }]]);
});
test('parallel attempts invoke adapter only once', async () => {
  const f = setup(); await Promise.all([f.run(), f.run(), f.run()]);
  assert.equal(f.calls.length, 1);
});
test('rejection never causes retry or leaks exception contents', async () => {
  let count = 0;
  const f = setup({ encryptstorage: async () => { count++; throw new Error('SECRET'); } });
  assert.deepEqual(await f.run(), { state: 'activation-outcome-unknown-no-retry' });
  assert.equal((await f.run()).state, 'blocked'); assert.equal(count, 1);
});
for (const claim of [async () => false, async () => { throw new Error(); }]) {
  test('durable claim failure prevents activation', async () => {
    const f = setup({ claimAttempt: claim });
    assert.equal((await f.run()).state, 'blocked'); assert.equal(f.calls.length, 0);
  });
}
test('unknown recovery evidence prevents activation', async () => {
  const f = setup({ observe: async () => ({ ...evidence(), remountRecoveryProof: undefined }) });
  assert.equal((await f.run()).state, 'blocked'); assert.equal(f.calls.length, 0);
});
test('slow claim invalidates stale evidence', async () => {
  let clock = time;
  const f = setup({ now: () => clock, claimAttempt: async () => { clock += 61_000; return true; } });
  assert.equal((await f.run()).state, 'blocked'); assert.equal(f.calls.length, 0);
});
