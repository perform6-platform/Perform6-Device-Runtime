import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort } from '../platform/bsMessagePort';
import { BridgeMsg } from './bridgeProtocol';
import { getKeepaliveBridgeSnapshot } from './bridgeKeepalive';

export interface RecoveryProvisioningConfiguration {
  serial: string;
  registrySection: 'networking';
  registryKey: 'ru';
  recoveryUrl: string;
  safeVersion: string;
}

let lastPostedUrl = '';
let lastPostedAt = 0;
const RETRY_INTERVAL_MS = 60_000;

function isTrustedRecoveryUrl(value: string): boolean {
  try {
    const recovery = new URL(value);
    const api = new URL(runtimeConfig.apiBaseUrl);
    const apiPath = api.pathname.replace(/\/+$/, '');
    return (
      recovery.protocol === 'https:' &&
      recovery.origin === api.origin &&
      recovery.pathname.startsWith(`${apiPath}/recovery/brightsign/`) &&
      recovery.searchParams.has('token')
    );
  } catch {
    return false;
  }
}

/**
 * Provision BOS recovery only after the authenticated app and duplex autorun
 * bridge are healthy. This is idempotent and intentionally does not reboot.
 */
export function provisionRecoveryAfterHealthyHeartbeat(
  config: RecoveryProvisioningConfiguration | null | undefined,
): boolean {
  if (!config) return false;
  const now = Date.now();
  if (
    config.recoveryUrl === lastPostedUrl &&
    now - lastPostedAt < RETRY_INTERVAL_MS
  ) {
    return false;
  }
  if (!isTrustedRecoveryUrl(config.recoveryUrl)) {
    console.warn('[Perform6] BOS recovery URL rejected by runtime trust policy');
    return false;
  }

  const bridge = getKeepaliveBridgeSnapshot();
  if (!bridge.healthy || !bridge.duplexReady) return false;

  const port = getSharedMessagePort();
  if (!port) return false;

  try {
    port.PostBSMessage({
      type: BridgeMsg.RECOVERY_CONFIG,
      url: config.recoveryUrl,
      serial: config.serial,
      safeVersion: config.safeVersion,
    });
    lastPostedUrl = config.recoveryUrl;
    lastPostedAt = now;
    console.info('[Perform6] BOS recovery provisioning requested after healthy heartbeat', {
      serial: config.serial,
      safeVersion: config.safeVersion,
    });
    return true;
  } catch (error) {
    console.warn('[Perform6] BOS recovery provisioning request failed', error);
    return false;
  }
}

export function resetRecoveryProvisioningForTests(): void {
  lastPostedUrl = '';
  lastPostedAt = 0;
}
