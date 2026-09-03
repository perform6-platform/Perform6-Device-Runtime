import { runtimeConfig, profileDefaultDeployment } from '../config/runtime';
import type { DeviceInfo } from '../shared/types';
import type { MockDeviceOptions } from '../shared/mockDevice';
import { isBrightSignPlayer, type BrightSignDeviceInfoLike } from './index';

const PROFILE_CODES = new Set(['XT2145', 'XC4055', 'HD226']);
const ZERO_MAC = '00:00:00:00:00:00';

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

/** Some OS builds expose identity as plain properties instead of methods. */
function propString(obj: object, ...names: string[]): string {
  const record = obj as Record<string, unknown>;
  for (const name of names) {
    try {
      const value = record[name];
      if (value != null && typeof value !== 'function' && String(value).trim()) {
        return String(value).trim();
      }
    } catch {
      /* ignore */
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

function isMacLike(value: string): boolean {
  return /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value);
}

function isPlaceholderSerial(serial: string, model?: string): boolean {
  if (!serial) return true;
  const upper = serial.toUpperCase();
  if (PROFILE_CODES.has(upper)) return true;
  if (model && serial.toLowerCase() === model.trim().toLowerCase()) return true;
  if (serial === ZERO_MAC) return true;
  return false;
}

function isUsableFirmware(fw: string): boolean {
  if (!fw) return false;
  const lower = fw.toLowerCase();
  return lower !== 'unknown' && lower !== 'n/a' && lower !== 'na';
}

function isUsableMac(mac: string): boolean {
  return Boolean(mac) && mac !== ZERO_MAC && isMacLike(mac);
}

/**
 * Identity injected by autorun.brs via file:///index.html?bs_serial=&bs_fw=&bs_mac=
 * Native roDeviceInfo is more reliable than Chromium BSDeviceInfo on many OS builds.
 */
export function readAutorunIdentityFromUrl(): {
  serialNumber?: string;
  model?: string;
  firmwareVersion?: string;
  macAddress?: string;
  ipAddress?: string;
} {
  if (typeof window === 'undefined') return {};

  try {
    const fromSearch = new URLSearchParams(window.location.search);
    // HashRouter may keep query on the document URL or before hash.
    const hash = window.location.hash || '';
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const fromHash = new URLSearchParams(hashQuery);

    const get = (key: string) =>
      (fromSearch.get(key) || fromHash.get(key) || '').trim();

    const serialNumber = get('bs_serial') || undefined;
    const model = get('bs_model') || undefined;
    const firmwareVersion = get('bs_fw') || undefined;
    const macRaw = get('bs_mac');
    const macAddress = macRaw ? formatMacAddress(macRaw) : undefined;
    const ipAddress = get('bs_ip') || undefined;

    if (serialNumber || model || firmwareVersion || macAddress || ipAddress) {
      console.info('[Perform6] Identity from autorun URL', {
        serialNumber,
        model,
        firmwareVersion,
        macAddress,
        ipAddress,
      });
    }

    return { serialNumber, model, firmwareVersion, macAddress, ipAddress };
  } catch (e) {
    console.warn('[Perform6] Failed to parse autorun identity URL', e);
    return {};
  }
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

function readFromBsDeviceInfo(): {
  model: string;
  firmwareVersion: string;
  uniqueId: string;
  deviceId: string;
  family: string;
  osVersion: string;
  bootVersion: string;
} | null {
  const Ctor = resolveDeviceInfoCtor();
  if (!Ctor) return null;

  let di: BrightSignDeviceInfoLike;
  try {
    di = new Ctor();
  } catch (e) {
    console.warn('[Perform6] BSDeviceInfo construct failed', e);
    return null;
  }

  const model =
    callString(di, 'getModel', 'GetModel') ||
    propString(di, 'model', 'Model');
  const osVersion =
    callString(di, 'getVersion', 'GetVersion') ||
    propString(di, 'version', 'Version', 'osVersion');
  const bootVersion =
    callString(di, 'getBootVersion', 'GetBootVersion') ||
    propString(di, 'bootVersion', 'BootVersion');
  const uniqueId =
    callString(di, 'getDeviceUniqueId', 'GetDeviceUniqueId') ||
    propString(di, 'deviceUniqueId', 'DeviceUniqueId', 'uniqueId', 'serialNumber');
  const deviceId =
    callString(di, 'getDeviceId', 'GetDeviceId') ||
    propString(di, 'deviceId', 'DeviceId');
  const family =
    callString(di, 'getFamily', 'GetFamily', 'getDeviceFamily', 'GetDeviceFamily') ||
    propString(di, 'family', 'Family');

  return {
    model,
    firmwareVersion: osVersion || bootVersion,
    uniqueId,
    deviceId,
    family,
    osVersion,
    bootVersion,
  };
}

/**
 * Read hardware identity: autorun URL (preferred) + BSDeviceInfo merge.
 * Never prefer model/profile code over a real BrightSign unique id.
 */
export function readBrightSignDeviceInfo(
  overrides: MockDeviceOptions = {},
): DeviceInfo | null {
  if (typeof window === 'undefined') return null;

  const fromUrl = readAutorunIdentityFromUrl();
  const fromBs = readFromBsDeviceInfo();

  if (!fromUrl.serialNumber && !fromBs) {
    console.warn('[Perform6] No autorun identity and no BSDeviceInfo — using profile fallback');
    return null;
  }

  const model =
    overrides.model ||
    fromUrl.model ||
    fromBs?.model ||
    runtimeConfig.hardwareProfile;

  const uniqueId = fromBs?.uniqueId || '';
  const serialCandidates = [
    overrides.serialNumber,
    fromUrl.serialNumber,
    uniqueId,
    fromBs?.deviceId,
  ].filter((s): s is string => Boolean(s && String(s).trim()));

  const serialNumber =
    serialCandidates.find((s) => !isPlaceholderSerial(s, model)) ||
    serialCandidates[0] ||
    '';

  if (!serialNumber || isPlaceholderSerial(serialNumber, model)) {
    console.warn('[Perform6] No usable BrightSign serial yet', {
      fromUrl,
      uniqueId,
      model,
    });
    // Still return an object if URL/BS gave something — caller may pair with model only as last resort.
    if (!serialNumber) return null;
  }

  const firmwareVersion =
    [
      overrides.firmwareVersion,
      fromUrl.firmwareVersion,
      fromBs?.firmwareVersion,
      fromBs?.osVersion,
      fromBs?.bootVersion,
      runtimeConfig.simFirmwareVersion,
    ]
      .filter((v): v is string => Boolean(v && isUsableFirmware(String(v))))
      .map(String)[0] || 'unknown';

  const macCandidates = [
    overrides.macAddress,
    fromUrl.macAddress,
    uniqueId && isMacLike(formatMacAddress(uniqueId))
      ? formatMacAddress(uniqueId)
      : '',
  ].filter(Boolean) as string[];

  const macAddress =
    macCandidates.map(formatMacAddress).find(isUsableMac) || ZERO_MAC;

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
    ipAddress: overrides.ipAddress || fromUrl.ipAddress || '',
    hardwareProfile,
    deploymentType,
    clusterMember,
    displayTarget: undefined,
    raw: {
      source: fromUrl.serialNumber ? 'autorun+BSDeviceInfo' : 'BSDeviceInfo',
      uniqueId: uniqueId || fromUrl.serialNumber || null,
      deviceId: fromBs?.deviceId || null,
      family: fromBs?.family || null,
      osVersion: fromBs?.osVersion || fromUrl.firmwareVersion || null,
      bootVersion: fromBs?.bootVersion || null,
      autorunSerial: fromUrl.serialNumber || null,
      autorunMac: fromUrl.macAddress || null,
      autorunFw: fromUrl.firmwareVersion || null,
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
