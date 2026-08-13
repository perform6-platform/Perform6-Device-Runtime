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
        /* try next name / firmware variant */
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

/**
 * Resolve BSDeviceInfo constructor across OS / Chromium variants.
 * Some firmwares expose it on window, some only on globalThis, some as @brightsign module.
 */
function resolveDeviceInfoCtor(): (new () => BrightSignDeviceInfoLike) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = typeof window !== 'undefined' ? (window as any) : null;

  const candidates = [
    w?.BSDeviceInfo,
    g?.BSDeviceInfo,
    w?.BrightSignDeviceInfo,
    g?.BrightSignDeviceInfo,
  ];

  for (const c of candidates) {
    if (typeof c === 'function') return c;
  }

  // Optional Node-style module on builds with nodejs_enabled (we do not require Node).
  try {
    if (typeof g.require === 'function') {
      const mod = g.require('@brightsign/deviceinfo');
      if (typeof mod === 'function') return mod;
      if (mod && typeof mod.BSDeviceInfo === 'function') return mod.BSDeviceInfo;
      if (mod && typeof mod.default === 'function') return mod.default;
    }
  } catch {
    /* Node / module not available — expected on most HtmlWidget builds */
  }

  return null;
}

/**
 * Read hardware identity from BrightSign JS objects (requires
 * brightsign_js_objects_enabled / AllowJavaScriptUrls on the HtmlWidget).
 * Returns null when this firmware does not expose device APIs — caller falls back.
 */
export function readBrightSignDeviceInfo(
  overrides: MockDeviceOptions = {},
): DeviceInfo | null {
  if (typeof window === 'undefined') return null;

  const Ctor = resolveDeviceInfoCtor();
  if (!Ctor) {
    console.warn('[Perform6] BSDeviceInfo not available on this firmware — using profile fallback');
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
  const osVersion = callString(di, 'getVersion', 'GetVersion');
  const bootVersion = callString(di, 'getBootVersion', 'GetBootVersion');
  const firmwareVersion =
    osVersion || bootVersion || runtimeConfig.simFirmwareVersion || 'unknown';
  const uniqueId = callString(di, 'getDeviceUniqueId', 'GetDeviceUniqueId');
  const deviceId = callString(di, 'getDeviceId', 'GetDeviceId');
  const family = callString(di, 'getFamily', 'GetFamily', 'getDeviceFamily', 'GetDeviceFamily');

  // Serial must stay stable for pairing; prefer hardware unique id / serial.
  const serialNumber = overrides.serialNumber || uniqueId || model;
  if (!serialNumber) {
    console.warn('[Perform6] No serial from BSDeviceInfo');
    return null;
  }

  const macAddress = uniqueId
    ? formatMacAddress(uniqueId)
    : overrides.macAddress || '00:00:00:00:00:00';

  const hardwareProfile = overrides.hardwareProfile ?? runtimeConfig.hardwareProfile;
  const deploymentType =
    overrides.deploymentType ?? profileDefaultDeployment(hardwareProfile);
  const clusterMember =
    hardwareProfile === 'HD226'
      ? (overrides.clusterMember ?? runtimeConfig.clusterMember)
      : undefined;

  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

  return {
    serialNumber,
    model,
    deviceName: overrides.deviceName ?? `Perform6 ${model}`,
    firmwareVersion,
    macAddress,
    ipAddress: overrides.ipAddress || '',
    hardwareProfile,
    deploymentType,
    clusterMember,
    displayTarget:
      hardwareProfile === 'XC4055'
        ? (overrides.displayTarget ?? runtimeConfig.displayTarget)
        : undefined,
    raw: {
      source: 'BSDeviceInfo',
      uniqueId: uniqueId || null,
      deviceId: deviceId || null,
      family: family || null,
      osVersion: osVersion || null,
      bootVersion: bootVersion || null,
      userAgent: userAgent || null,
      screen:
        typeof window !== 'undefined'
          ? {
              width: window.screen?.width ?? null,
              height: window.screen?.height ?? null,
              availWidth: window.screen?.availWidth ?? null,
              availHeight: window.screen?.availHeight ?? null,
              devicePixelRatio: window.devicePixelRatio ?? null,
            }
          : null,
      collectedAt: new Date().toISOString(),
    },
  };
}

export function shouldUseBrightSignDeviceApis(): boolean {
  return !runtimeConfig.isSimulator && isBrightSignPlayer();
}
