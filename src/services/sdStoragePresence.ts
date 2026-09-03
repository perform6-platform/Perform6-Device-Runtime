import { subscribeBsMessages } from '../platform/bsMessagePort';
import { runtimeConfig } from '../config/runtime';

const STORAGE_TYPE = 'led-storage';

export type SdStorageEvent = 'attached' | 'detached';

export type SdStoragePresence = {
  /** Last known SD presence. Null until first report (simulator). */
  sdPresent: boolean | null;
  sdEvent: SdStorageEvent | null;
  sdEventAt: string | null;
  sdMount: string;
};

let presence: SdStoragePresence = {
  sdPresent: runtimeConfig.isSimulator ? null : true,
  sdEvent: runtimeConfig.isSimulator ? null : 'attached',
  sdEventAt: runtimeConfig.isSimulator ? null : new Date().toISOString(),
  sdMount: 'SD:',
};

const listeners = new Set<() => void>();
let bridgeInstalled = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function isSdMount(path: string): boolean {
  if (!path.trim()) return true;
  const upper = path.toUpperCase();
  return upper.includes('SD') || upper.includes('MMC');
}

export function getSdStoragePresence(): SdStoragePresence {
  return { ...presence };
}

export function subscribeSdStoragePresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Listen for autorun led-storage attach/detach messages. */
export function initSdStoragePresence(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  subscribeBsMessages((event) => {
    const data = event.data ?? {};
    if (String(data.type ?? '') !== STORAGE_TYPE) return;
    const path = String(data.path ?? '');
    if (!isSdMount(path)) return;
    const state = String(data.state ?? '').toLowerCase();
    const attached = state === 'attached';
    const detached = state === 'detached';
    if (!attached && !detached) return;
    presence = {
      sdPresent: attached,
      sdEvent: attached ? 'attached' : 'detached',
      sdEventAt: new Date().toISOString(),
      sdMount: path || 'SD:',
    };
    console.info('[Perform6] SD storage', presence);
    notify();
  });
}
