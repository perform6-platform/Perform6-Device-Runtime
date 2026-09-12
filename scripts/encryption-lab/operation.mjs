import { evaluateEncryptionPreflight } from './preflight.mjs';

// Unwired prototype: callers supply ALL adapters. No BrightSign imports,
// timer, reboot, key deletion, or automatic retry. Not packaged in runtime.
// claimAttempt must be an atomic, durable, device-wide latch outside SD;
// an in-memory boolean or SD marker is NOT a production implementation.
export function createEncryptionOperation({ observe, claimAttempt, encryptstorage, now = Date.now }) {
  let attempted = false;
  return async function activate() {
    if (attempted) return { state: 'blocked', blockers: ['attempt-already-consumed'] };
    // Latch before awaiting: overlapping callers cannot both invoke encryption.
    attempted = true;
    let evidence;
    try { evidence = await observe(); }
    catch { return { state: 'blocked', blockers: ['observation-failed'] }; }
    const gate = evaluateEncryptionPreflight(evidence, now());
    if (!gate.eligibleForReview) return { state: 'blocked', blockers: gate.blockers };
    try {
      if (await claimAttempt(evidence.serial, evidence.candidateSha256) !== true) {
        return { state: 'blocked', blockers: ['durable-attempt-claim-denied'] };
      }
    } catch { return { state: 'blocked', blockers: ['durable-attempt-claim-failed'] }; }
    // Claim latency must not silently make the original observations stale.
    const finalGate = evaluateEncryptionPreflight(evidence, now());
    if (!finalGate.eligibleForReview) return { state: 'blocked', blockers: finalGate.blockers };
    try {
      await encryptstorage('/storage/sd', { method: 'generate key', format: false });
      // Resolution is NOT proof of encrypted files, successful boot, or OTA.
      return { state: 'api-returned-verification-required' };
    } catch {
      // Never retry or expose raw exception text (could contain sensitive data).
      // A rejected promise may follow a partial operation: state is unknown.
      return { state: 'activation-outcome-unknown-no-retry' };
    }
  };
}
