import { runtimeConfig, profileDefaultDeployment } from '../config/runtime';
import type { DeviceInfo } from '../shared/types';
import type { MockDeviceOptions } from '../shared/mockDevice';
import { isBrightSignPlayer, type BrightSignDeviceInfoLike } from './index';

function callString(obj: BrightSignDeviceInfoLike, ...names: (keyof BrightSignDeviceInfoLike)[]): string {
  for (const name of names) {
    const fn = obj[name];
    if (typeof fn === 'function') {
      try {
        const value = (fn as () => unknown).call(obj);
        if (value != null && String(value).trim()) return String(value).trim();
      } catch {
        /* try next */
      }
    }
  }
  return '';
}

/** Format AA:BB:CC:DD:EE:FF from BrightSign unique id / MAC-like strings. */
export function formatMacAddress(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length === 12) {
    return hex.match(/.{1,2}/g)!.join(':').toLowerCase();
  }
  if (/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(raw)) {
    return raw.toLowerCase();
  }
  return raw;
}

function readIpFromBrowser(): string {
  // Best-effort; BrightSign HTML often has no WebRTC. Leave empty for caller fallback.
  return '';
}

/**
 * Read hardware identity from BrightSign JS objects (requires
 * brightsign_js_objects_enabled / AllowJavaScriptUrls on the HtmlWidget).
 */
export function readBrightSignDeviceInfo(
  overrides: MockDeviceOptions = {},
): DeviceInfo | null {
  if (typeof window === 'undefined') return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window as any).BSDeviceInfo ?? (globalThis as any).BSDeviceInfo;
  if (typeof Ctor !== 'function') {
    console.warn('[Perform6] BSDeviceInfo not available — enable brightsign_js_objects');
    return null;
  }

  let di: BrightSignDeviceInfoLike;
  try {
    di = new Ctor();
  } catch (e) {
    console.warn('[Perform6] BSDeviceInfo construct failed', e);
    return null;
  }

  const model = callString(di, 'getModel', 'GetModel') || runtimeConfig.hardwareProfile;
  const firmwareVersion =
    callString(di, 'getVersion', 'GetVersion', 'getBootVersion', 'GetBootVersion') ||
    runtimeConfig.simFirmwareVersion ||
    'unknown';
  const uniqueId = callString(di, 'getDeviceUniqueId', 'GetDeviceUniqueId');
  const macAddress = uniqueId
    ? formatMacAddress(uniqueId)
    : overrides.macAddress || '00:00:00:00:00:00';

  // Prefer real BrightSign serial (UTF…) over baked profile-serial mocks.
  const serialNumber = overrides.serialNumber || uniqueId || model;

  const hardwareProfile = overrides.hardwareProfile ?? runtimeConfig.hardwareProfile;
  const deploymentType =
    overrides.deploymentType ?? profileDefaultDeployment(hardwareProfile);
  const clusterMember =
    hardwareProfile === 'HD226'
      ? (overrides.clusterMember ?? runtimeConfig.clusterMember)
      : undefined;

  return {
    serialNumber,
    model,
    deviceName: overrides.deviceName ?? `Perform6 ${model}`,
    firmwareVersion,
    macAddress,
    ipAddress: overrides.ipAddress || readIpFromBrowser() || '',
    hardwareProfile,
    deploymentType,
    clusterMember,
    displayTarget:
      hardwareProfile === 'XC4055'
        ? (overrides.displayTarget ?? runtimeConfig.displayTarget)
        : undefined,
  };
}

export function shouldUseBrightSignDeviceApis(): boolean {
  return !runtimeConfig.isSimulator && isBrightSignPlayer();
}
