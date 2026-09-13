// Offline eligibility evaluation only. No device API, filesystem mutation,
// network operation, key generation, or reboot is implemented here.
export function evaluateEncryptionPreflight(input, now = Date.now()) {
  const e = input ?? {};
  const blockers = [];
  const require = (condition, reason) => { if (!condition) blockers.push(reason); };
  require(Number.isFinite(now), 'invalid-clock');
  require(e.serial === 'UTF54M000145', 'wrong-device');
  require(e.model === 'XT2145' && e.os === '9.1.93.2', 'unreviewed-hardware-or-os');
  require(e.mount === '/storage/sd', 'wrong-storage');
  require(e.format === false, 'format-must-be-explicitly-false');
  require(e.apiAvailable === true, 'encryption-api-unverified');
  require(e.filesystemType === 'exfat', 'filesystem-requires-review');
  require(e.priorKeyState === 'verified-absent', 'prior-key-state-unknown-or-present');
  require(e.attemptState === 'verified-absent', 'prior-attempt-unknown-or-present');
  require(e.mediaIdle === true && e.otaIdle === true, 'writers-not-confirmed-idle');
  require(e.mediaPaused === true, 'automatic-media-retry-not-paused');
  require(e.otaReachable === true, 'ota-control-unverified');
  const fresh = (at, age) => Number.isFinite(at) && Number.isFinite(now)
    && at <= now && now - at <= age;
  require(fresh(e.observedAt, 60_000), 'stale-or-missing-observation');
  const beats = e.authenticatedHeartbeatTimes;
  require(Array.isArray(beats) && beats.length >= 2
    && beats.every((at, i) => fresh(at, 180_000) && (i === 0 || at > beats[i - 1]))
    && fresh(beats.at(-1), 60_000), 'fresh-distinct-authenticated-heartbeats-required');
  require(typeof e.candidateSha256 === 'string' && /^[a-f0-9]{64}$/.test(e.candidateSha256),
    'candidate-checksum-missing');
  require(e.packageGateSha256 === e.candidateSha256 && Boolean(e.candidateSha256),
    'package-gate-does-not-match-candidate');
  const recovery = e.recovery ?? {};
  require(recovery.registryReadback === true && recovery.endpointReachable === true
    && recovery.safeVersion === '1.5.23' && recovery.packageChecksumVerified === true,
  'os-recovery-fallback-unverified');
  // An endpoint returning HTTP 200 is not evidence of recovery after an SD
  // remount failure. Require a separately reviewed hardware test record.
  const proof = e.remountRecoveryProof ?? {};
  require(proof.reviewed === true && typeof proof.report === 'string' && proof.report.trim() !== ''
    && proof.model === e.model && proof.os === e.os
    && proof.candidateSha256 === e.candidateSha256
    && proof.survivesSdUnavailable === true && proof.unattendedRecoveryObserved === true,
  'independent-remount-recovery-unproven');
  return { eligibleForReview: blockers.length === 0, activationImplemented: false, blockers };
}
