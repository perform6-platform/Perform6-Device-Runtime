import { verifyDelivery } from './signed-delivery.mjs';
import { unwrapMediaKey, verifyCiphertext } from './key-delivery.mjs';
import { playbackKeyBytes } from './media-pipeline.mjs';

// Offline verification composition only. Does not call a player, change a
// playlist, persist keys, or return secrets. This is NOT a playback permit:
// the file can change later, and native compatibility is still untested.
export async function validateCandidate({ publicPem, privateKey, fingerprint,
  delivery, signature, source, report = () => {}, timeoutMs = 30000 }) {
  let key, playbackBytes;
  let expired = false, timer;
  let stage = 'signature';
  function emit(event) {
    if (expired) return;
    try { Promise.resolve(report(Object.freeze({ event, stage }))).catch(() => {}); }
    catch { /* Reporting cannot turn failure into success. */ }
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    return Object.freeze({ verified: false, stage: 'configuration' });
  }
  const run = async () => { try {
    const verified = verifyDelivery(publicPem, delivery, signature, fingerprint);
    stage = 'ciphertext';
    await verifyCiphertext(source, verified.manifest);
    if (expired) return Object.freeze({ verified: false, stage: 'timeout' });
    stage = 'key';
    key = unwrapMediaKey(privateKey, verified.assetId, verified.manifest, verified.wrappedKey);
    playbackBytes = playbackKeyBytes(key, verified.manifest.ivHex);
    stage = 'verified';
    emit('ENCRYPTED_CANDIDATE_VERIFIED_OFFLINE');
    return Object.freeze({ verified: true, assetId: verified.assetId });
  } catch {
    emit('ENCRYPTED_CANDIDATE_REJECTED');
    return Object.freeze({ verified: false, stage });
  } finally {
    key?.fill(0);
    playbackBytes?.fill(0);
  } };
  try {
    return await Promise.race([run(), new Promise(resolve => {
      timer = setTimeout(() => {
        emit('ENCRYPTED_CANDIDATE_TIMEOUT');
        expired = true;
        resolve(Object.freeze({ verified: false, stage: 'timeout' }));
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
  // Timeout suppresses later key processing; it cannot cancel an arbitrary
  // iterator or interrupt synchronous crypto. Real I/O needs abort support.
}
