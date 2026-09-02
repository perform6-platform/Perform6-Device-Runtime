import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';

const OPS_FILE = 'perform6-ops.json';
const OPS_FETCH_URLS = [
  'file:///SD:/perform6-ops.json',
  'file:///perform6-ops.json',
] as const;

const OPS_RELOAD_MESSAGE = 'led-ops-reload';
const OPS_WRITE_MESSAGE = 'led-ops-write';
const OPS_CONFIG_TYPE = 'led-ops-config';

export interface Perform6Ops {
  version: number;
  pauseMediaSync: boolean;
  pauseOta: boolean;
  clearCacheOnBoot: boolean;
  rebootAfterCacheClear: boolean;
  syncOnBoot: boolean;
}

export const DEFAULT_PERFORM6_OPS: Perform6Ops = {
  version: 1,
  pauseMediaSync: false,
  pauseOta: false,
  clearCacheOnBoot: false,
  rebootAfterCacheClear: false,
  syncOnBoot: false,
};

let currentOps: Perform6Ops = { ...DEFAULT_PERFORM6_OPS };
let reloadPromise: Promise<Perform6Ops> | null = null;
let requestCounter = 0;

function normalizeOps(raw: unknown): Perform6Ops {
  const data =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    version:
      typeof data.version === 'number' && Number.isFinite(data.version)
        ? data.version
        : DEFAULT_PERFORM6_OPS.version,
    pauseMediaSync: data.pauseMediaSync === true,
    pauseOta: data.pauseOta === true,
    clearCacheOnBoot: data.clearCacheOnBoot === true,
    rebootAfterCacheClear: data.rebootAfterCacheClear === true,
    syncOnBoot: data.syncOnBoot === true,
  };
}

function opsChanged(prev: Perform6Ops, next: Perform6Ops): boolean {
  return (
    prev.version !== next.version ||
    prev.pauseMediaSync !== next.pauseMediaSync ||
    prev.pauseOta !== next.pauseOta ||
    prev.clearCacheOnBoot !== next.clearCacheOnBoot ||
    prev.rebootAfterCacheClear !== next.rebootAfterCacheClear ||
    prev.syncOnBoot !== next.syncOnBoot
  );
}

function applyOps(next: Perform6Ops): Perform6Ops {
  const changed = opsChanged(currentOps, next);
  currentOps = next;
  if (changed) {
    console.info('[Perform6] perform6-ops.json applied', next);
  }
  return currentOps;
}

export function getPerform6Ops(): Readonly<Perform6Ops> {
  return currentOps;
}

export function isMediaSyncPaused(): boolean {
  return currentOps.pauseMediaSync;
}

export function isOtaPaused(): boolean {
  return currentOps.pauseOta;
}

async function fetchOpsFromSd(): Promise<Perform6Ops | null> {
  for (const url of OPS_FETCH_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const raw = await response.json();
      return normalizeOps(raw);
    } catch {
      /* try next path */
    }
  }
  return null;
}

function requestOpsViaBsMessage(timeoutMs = 8_000): Promise<Perform6Ops | null> {
  const port = getSharedMessagePort();
  if (!port) return Promise.resolve(null);

  const requestId = `ops-${Date.now()}-${++requestCounter}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ops: Perform6Ops | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(ops);
    };

    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== OPS_CONFIG_TYPE) return;
      if (String(data.requestId ?? '') !== requestId) return;
      const content = String(data.content ?? '').trim();
      if (!content) {
        finish({ ...DEFAULT_PERFORM6_OPS });
        return;
      }
      try {
        finish(normalizeOps(JSON.parse(content)));
      } catch {
        finish({ ...DEFAULT_PERFORM6_OPS });
      }
    });

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    port.PostBSMessage({ type: OPS_RELOAD_MESSAGE, requestId });
  });
}

export async function reloadPerform6Ops(): Promise<Perform6Ops> {
  if (reloadPromise) return reloadPromise;

  reloadPromise = (async () => {
    if (runtimeConfig.isSimulator) {
      return applyOps({ ...DEFAULT_PERFORM6_OPS });
    }

    const fromSd = await fetchOpsFromSd();
    if (fromSd) return applyOps(fromSd);

    const fromBs = await requestOpsViaBsMessage();
    if (fromBs) return applyOps(fromBs);

    return applyOps({ ...DEFAULT_PERFORM6_OPS });
  })().finally(() => {
    reloadPromise = null;
  });

  return reloadPromise;
}

export async function persistPerform6Ops(ops: Perform6Ops): Promise<void> {
  const next = normalizeOps(ops);
  applyOps(next);

  if (runtimeConfig.isSimulator) return;

  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] perform6-ops.json write skipped — BSMessagePort missing');
    return;
  }

  port.PostBSMessage({
    type: OPS_WRITE_MESSAGE,
    content: `${JSON.stringify(next, null, 2)}\n`,
  });
}

/** One-shot flag: run sync once, then clear in the SD file. */
export async function consumeSyncOnBoot(): Promise<boolean> {
  await reloadPerform6Ops();
  if (!currentOps.syncOnBoot) return false;

  const next = { ...currentOps, syncOnBoot: false };
  await persistPerform6Ops(next);
  return true;
}

export function startPerform6OpsPolling(intervalMs = 60_000): () => void {
  void reloadPerform6Ops();

  const id = window.setInterval(() => {
    void reloadPerform6Ops();
  }, intervalMs);

  return () => window.clearInterval(id);
}

export const PERFORM6_OPS_FILE = OPS_FILE;
