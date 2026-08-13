import { browserPlatform } from './browser';
import { brightsignPlatform } from './brightsign';
import { runtimeConfig } from '../config/runtime';

export interface Platform {
  name: 'browser' | 'brightsign';
  init(): void;
}

declare global {
  interface Window {
    brightsign?: unknown;
    BSDeviceInfo?: new () => BrightSignDeviceInfoLike;
    __perform6AppMounted?: boolean;
    __perform6ScriptFailed?: () => void;
    __perform6MountFailed?: (detail?: string) => void;
  }
}

/** Subset of BrightSign BSDeviceInfo (method names vary by OS). */
export interface BrightSignDeviceInfoLike {
  getModel?: () => string;
  GetModel?: () => string;
  getVersion?: () => string;
  GetVersion?: () => string;
  getDeviceUniqueId?: () => string;
  GetDeviceUniqueId?: () => string;
  getBootVersion?: () => string;
  GetBootVersion?: () => string;
  getFamily?: () => string;
  GetFamily?: () => string;
}

export function isBrightSignPlayer(): boolean {
  if (typeof window === 'undefined') return false;

  // Production BrightSign builds always bake this mode.
  if (runtimeConfig.runtimeMode === 'BRIGHTSIGN') return true;

  const w = window;
  if (w.brightsign) return true;
  if (typeof w.BSDeviceInfo === 'function') return true;

  try {
    // Some OS builds expose the ctor as a global without `window.` enumeration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.BSDeviceInfo === 'function') return true;
  } catch {
    /* ignore */
  }

  return false;
}

export function getPlatform(): Platform {
  return isBrightSignPlayer() ? brightsignPlatform : browserPlatform;
}
