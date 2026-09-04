/**
 * Ask autorun for SD card free/capacity (roStorageInfo).
 * Cached for heartbeats so Admin can show real storage usage.
 */
import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';
import { runtimeConfig } from '../config/runtime';

const REQ = 'led-storage-info';
const RES = 'led-storage-info-result';

export type SdStorageSnapshot = {
  freeBytes: number;
  capacityBytes: number;
  usedBytes: number;
  freeMb: number;
  capacityMb: number;
  updatedAtMs: number;
};

let cached: SdStorageSnapshot | null = null;
let inFlight: Promise<SdStorageSnapshot | null> | null = null;

export function getCachedSdStorage(): SdStorageSnapshot | null {
  return cached;
}

function mbToBytes(mb: number): number {
  if (!Number.isFinite(mb) || mb < 0) return 0;
  return Math.round(mb * 1048576);
}

export async function refreshSdStorageInfo(
  timeoutMs = 8_000,
): Promise<SdStorageSnapshot | null> {
  if (runtimeConfig.isSimulator) {
    const snap: SdStorageSnapshot = {
      freeMb: 32_000,
      capacityMb: 64_000,
      freeBytes: mbToBytes(32_000),
      capacityBytes: mbToBytes(64_000),
      usedBytes: mbToBytes(32_000),
      updatedAtMs: Date.now(),
    };
    cached = snap;
    return snap;
  }

  // Prefer Node @brightsign/storageinfo when HtmlWidget has Node enabled.
  try {
    const req =
      typeof (globalThis as { require?: (id: string) => unknown }).require === 'function'
        ? (globalThis as { require: (id: string) => unknown }).require
        : null;
    if (req) {
      const StorageInfo = req('@brightsign/storageinfo') as {
        new (path?: string): {
          getFreeInMegabytes?: () => number | Promise<number>;
          getSizeInMegabytes?: () => number | Promise<number>;
        };
      };
      // Prefer Linux mount. Bare "SD:" / "sd" can log File not accessible: "/SD:".
      for (const mount of ['/storage/sd', 'SD:/']) {
        try {
          const si = new StorageInfo(mount);
          const freeRaw = await Promise.resolve(si.getFreeInMegabytes?.() ?? 0);
          const sizeRaw = await Promise.resolve(si.getSizeInMegabytes?.() ?? 0);
          const freeMb = Number(freeRaw) || 0;
          const capacityMb = Number(sizeRaw) || 0;
          if (freeMb > 0 || capacityMb > 0) {
            const usedMb = capacityMb > freeMb ? capacityMb - freeMb : 0;
            const snap: SdStorageSnapshot = {
              freeMb,
              capacityMb,
              freeBytes: mbToBytes(freeMb),
              capacityBytes: mbToBytes(capacityMb),
              usedBytes: mbToBytes(usedMb),
              updatedAtMs: Date.now(),
            };
            cached = snap;
            return snap;
          }
        } catch {
          /* try next mount path */
        }
      }
    }
  } catch {
    /* fall through to autorun */
  }

  if (inFlight) return inFlight;

  const port = getSharedMessagePort();
  if (!port) return cached;

  inFlight = new Promise((resolve) => {
    let settled = false;
    const finish = (snap: SdStorageSnapshot | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      inFlight = null;
      if (snap) cached = snap;
      resolve(snap ?? cached);
    };

    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== RES) return;
      const freeMb = Number(data.freeMb ?? 0);
      const capacityMb = Number(data.capacityMb ?? 0);
      if (!Number.isFinite(freeMb) || freeMb < 0) {
        finish(null);
        return;
      }
      const capacity = Number.isFinite(capacityMb) && capacityMb > 0 ? capacityMb : 0;
      const usedMb =
        capacity > 0 ? Math.max(0, capacity - freeMb) : Number(data.usedMb ?? 0) || 0;
      finish({
        freeMb,
        capacityMb: capacity,
        freeBytes: mbToBytes(freeMb),
        capacityBytes: mbToBytes(capacity),
        usedBytes: mbToBytes(usedMb),
        updatedAtMs: Date.now(),
      });
    });

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    try {
      port.PostBSMessage({ type: REQ });
    } catch {
      finish(null);
    }
  });

  return inFlight;
}

/** Best-effort snapshot for heartbeat (refresh if stale > 2 min). */
export async function getSdStorageForHeartbeat(): Promise<{
  storageUsedBytes?: string;
  storageCapacityBytes?: string;
}> {
  const stale =
    !cached || Date.now() - cached.updatedAtMs > 2 * 60_000;
  if (stale) {
    await refreshSdStorageInfo();
  }
  if (!cached || cached.capacityBytes <= 0) {
    // Still report free-derived used=0 capacity unknown — skip if nothing useful.
    if (cached && cached.freeBytes > 0 && cached.capacityBytes <= 0) {
      return {};
    }
    return {};
  }
  return {
    storageUsedBytes: String(cached.usedBytes),
    storageCapacityBytes: String(cached.capacityBytes),
  };
}
