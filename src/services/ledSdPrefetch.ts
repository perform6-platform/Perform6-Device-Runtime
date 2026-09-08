/**
 * @deprecated Media uses AssetPool + AssetRealizer only.
 * Autorun led-cache-prefetch is disabled (unreliable bridge / Bluefin spam).
 */
export {
  requestSdCachePrefetch as requestLedSdPrefetch,
  downloadMediaItemsToSd,
  type SdCacheProgressEvent,
} from './sdCacheBridge';
import type { SyncCheckResponseData } from '../shared/types/api';

/** @deprecated Sync engine owns downloads; no-op. */
export function collectLedPrefetchUrls(
  syncData: SyncCheckResponseData | null | undefined,
): string[] {
  return (syncData?.media ?? [])
    .map((m) => m.fileUrl)
    .filter(Boolean);
}

/** @deprecated Autorun prefetch disabled — no-op. */
export function prefetchLedSdFromSync(
  _syncData: SyncCheckResponseData | null | undefined,
): void {
  /* intentional no-op */
}
