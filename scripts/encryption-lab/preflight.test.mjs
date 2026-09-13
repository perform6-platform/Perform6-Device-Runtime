import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEncryptionPreflight } from './preflight.mjs';

const now = 1_800_000_000_000;
const fixture = () => ({
  serial: 'UTF54M000145', model: 'XT2145', os: '9.1.93.2', mount: '/storage/sd',
  format: false, apiAvailable: true, filesystemType: 'exfat',
  priorKeyState: 'verified-absent', attemptState: 'verified-absent',
  mediaIdle: true, otaIdle: true, mediaPaused: true, otaReachable: true,
  observedAt: now, authenticatedHeartbeatTimes: [now - 60_000, now],
  candidateSha256: 'a'.repeat(64), packageGateSha256: 'a'.repeat(64),
  recovery: { registryReadback: true, endpointReachable: true, safeVersion: '1.5.23', packageChecksumVerified: true },
  remountRecoveryProof: { reviewed: true, report: 'SYNTHETIC TEST FIXTURE ONLY',
    model: 'XT2145', os: '9.1.93.2', candidateSha256: 'a'.repeat(64),
    survivesSdUnavailable: true, unattendedRecoveryObserved: true },
});
test('missing observations fail closed', () => {
  assert.equal(evaluateEncryptionPreflight(undefined, now).eligibleForReview, false);
});
test('even complete synthetic evidence cannot execute activation', () => {
  assert.deepEqual(evaluateEncryptionPreflight(fixture(), now), {
    eligibleForReview: true, activationImplemented: false, blockers: [],
  });
});
for (const [name, patch, reason] of [
  ['healthy app and reachable recovery URL alone', { remountRecoveryProof: undefined }, 'independent-remount-recovery-unproven'],
  ['unknown persisted key after SD format', { priorKeyState: undefined }, 'prior-key-state-unknown-or-present'],
  ['previous attempt', { attemptState: 'present' }, 'prior-attempt-unknown-or-present'],
  ['media transfer active', { mediaIdle: false }, 'writers-not-confirmed-idle'],
  ['OTA active', { otaIdle: false }, 'writers-not-confirmed-idle'],
  ['periodic media retry enabled', { mediaPaused: false }, 'automatic-media-retry-not-paused'],
  ['format omitted', { format: undefined }, 'format-must-be-explicitly-false'],
  ['format true', { format: true }, 'format-must-be-explicitly-false'],
  ['stale observation', { observedAt: now - 60_001 }, 'stale-or-missing-observation'],
  ['future observation', { observedAt: now + 1 }, 'stale-or-missing-observation'],
  ['duplicate heartbeat', { authenticatedHeartbeatTimes: [now, now] }, 'fresh-distinct-authenticated-heartbeats-required'],
  ['changed candidate', { candidateSha256: 'b'.repeat(64) }, 'package-gate-does-not-match-candidate'],
  ['wrong player', { serial: 'OTHER' }, 'wrong-device'],
  ['unknown API', { apiAvailable: undefined }, 'encryption-api-unverified'],
]) {
  test(`blocks ${name}`, () => {
    const result = evaluateEncryptionPreflight({ ...fixture(), ...patch }, now);
    assert.equal(result.eligibleForReview, false);
    assert.ok(result.blockers.includes(reason));
  });
}
test('evaluation is repeatable and does not mutate evidence', () => {
  const data = fixture();
  const before = structuredClone(data);
  assert.deepEqual(evaluateEncryptionPreflight(data, now), evaluateEncryptionPreflight(data, now));
  assert.deepEqual(data, before);
});
