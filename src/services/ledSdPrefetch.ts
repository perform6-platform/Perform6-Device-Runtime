/**
 * @deprecated Use sdCacheBridge — SD:/perform6-cache is the only media store.
 * Kept as a thin re-export so older imports do not break during the cutover.
 */
export {
  requestSdCachePrefetch as requestLedSdPrefetch,
  downloadMediaItemsToSd,
  type SdCacheProgressEvent,
} from './sdCacheBridge';
import type { SyncCheckResponseData } from '../shared/types/api';
import { requestSdCachePrefetch } from './sdCacheBridge';

/** @deprecated Sync engine owns prefetch; no-op wrapper for RuntimeContext. */
export function collectLedPrefetchUrls(
  syncData: SyncCheckResponseData | null | undefined,
): string[] {
  return (syncData?.media ?? [])
    .map((m) => m.fileUrl)
    .filter(Boolean);
}

/** @deprecated Prefer runSyncEngine SD downloads. */
export function prefetchLedSdFromSync(
  syncData: SyncCheckResponseData | null | undefined,
): void {
  if (!syncData?.media?.length) return;
  requestSdCachePrefetch(
    syncData.media.map((m) => ({
      mediaVersionId: m.mediaVersionId,
      fileUrl: m.fileUrl,
    })),
  );
}
