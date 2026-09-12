/**
 * 1.5.44-only hardware interoperability probe.
 *
 * It is armed only after a successful API heartbeat. It creates one random
 * AES-128 key/IV pair in Chromium memory and passes it over the existing,
 * field-proven Node message port. Autorun stores and independently reads the
 * reserved probe record from the player registry, then writes only fixed
 * status to perform6-led.log. It never touches media, startup files or OTA.
 */
import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort } from '../platform/bsMessagePort';

const CANDIDATE_VERSION = '1.5.44';
const PROBE_ID = 'probe_1_5_44';
let attempted = false;

function randomHex16(): string | null {
  try {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function startMediaKeyInteropProbe(heartbeatConfirmed: boolean): void {
  if (attempted || heartbeatConfirmed !== true) return;
  if (runtimeConfig.runtimeMode !== 'BRIGHTSIGN') return;
  if (runtimeConfig.hardwareProfile !== 'XT2145') return;
  if (runtimeConfig.runtimeVersion !== CANDIDATE_VERSION) return;

  // Latch before all fallible work: failure is reported once and never loops.
  attempted = true;
  window.setTimeout(() => {
    let keyHex = randomHex16();
    let ivHex = randomHex16();
    if (!keyHex || !ivHex || keyHex.slice(0, 16) === keyHex.slice(16)) {
      console.warn('[Perform6] MEDIA|KEY_PROBE|dispatch=denied|reason=random-unavailable');
      keyHex = null;
      ivHex = null;
      return;
    }

    const port = getSharedMessagePort();
    if (!port) {
      console.warn('[Perform6] MEDIA|KEY_PROBE|dispatch=denied|reason=control-port-unavailable');
      keyHex = null;
      ivHex = null;
      return;
    }

    try {
      // Never log this object. The key exists only in memory and player registry.
      port.PostBSMessage({
        type: 'p6-media-key-probe',
        requestId: PROBE_ID,
        assetId: PROBE_ID,
        keyHex,
        ivHex,
      });
      console.info('[Perform6] MEDIA|KEY_PROBE|dispatch=sent|result=await-sd-telemetry');
    } catch {
      console.warn('[Perform6] MEDIA|KEY_PROBE|dispatch=failed');
    } finally {
      keyHex = null;
      ivHex = null;
    }
  }, 2_000);
}

