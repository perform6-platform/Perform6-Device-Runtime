/**
 * 1.5.51-only event-correlated AES-CTR playback interoperability probe.
 *
 * This is deliberately not the production key-delivery design. The bundled
 * ciphertext is a synthetic two-second test pattern and the matching lab key
 * is useful only for that fixture. After an authenticated heartbeat, the key
 * is persisted through the already-proven native registry path and the same
 * native HDMI-2 player attempts encrypted playback. Autorun waits for native
 * Playing + MediaEnded evidence (or a bounded failure/timeout) before it
 * restores the previous plaintext source.
 */
import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort } from '../platform/bsMessagePort';

const CANDIDATE_VERSION = '1.5.51';
const PROBE_ID = 'probe_1_5_51';
const FIXTURE_PATH = 'SD:/perform6-encryption-test/perform6-encrypted-probe.p6enc';
const LAB_KEY_HEX = '4f8c2a7d90b1e3f6572849acdb0e1357';
const LAB_IV_HEX = 'a1c3e5f7092b4d6f8193a5c7e9fb1d2f';
let attempted = false;

export function startEncryptedPlaybackInteropProbe(heartbeatConfirmed: boolean): void {
  if (attempted || heartbeatConfirmed !== true) return;
  if (runtimeConfig.runtimeMode !== 'BRIGHTSIGN') return;
  if (runtimeConfig.hardwareProfile !== 'XT2145') return;
  if (runtimeConfig.runtimeVersion !== CANDIDATE_VERSION) return;

  // Latch before any native message. There is no retry loop or reboot path.
  attempted = true;
  window.setTimeout(() => {
    const port = getSharedMessagePort();
    if (!port) {
      console.warn('[Perform6] MEDIA|ENCRYPTED_PROBE|dispatch=denied|reason=control-port-unavailable');
      return;
    }

    let keyHex: string | null = LAB_KEY_HEX;
    let ivHex: string | null = LAB_IV_HEX;
    try {
      // Store first. The native event loop processes messages in order.
      port.PostBSMessage({
        type: 'p6-media-key-probe',
        requestId: PROBE_ID,
        assetId: PROBE_ID,
        keyHex,
        ivHex,
      });
      keyHex = null;
      ivHex = null;
      port.PostBSMessage({
        type: 'p6-encrypted-playback-probe',
        requestId: PROBE_ID,
        assetId: PROBE_ID,
        src: FIXTURE_PATH,
      });
      console.info('[Perform6] MEDIA|ENCRYPTED_PROBE|dispatch=sent|result=await-sd-telemetry');
    } catch {
      console.warn('[Perform6] MEDIA|ENCRYPTED_PROBE|dispatch=failed');
    } finally {
      keyHex = null;
      ivHex = null;
    }
  }, 2_000);
}
