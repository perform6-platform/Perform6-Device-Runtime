/**
 * Cancel media only — never touches OTA.
 * Also exposes stuck-lock clearing for periodic sync self-heal.
 */
import {
  forceClearSdBulkDownloadLock,
  isSdBulkDownloadInProgress,
  requestSdCacheCancel,
} from './sdCacheBridge';
import {
  cancelMediaAssetPoolFetch,
  forceClearMediaAssetPoolLock,
  isMediaAssetPoolDownloadInProgress,
} from './mediaAssetPool';

export function isMediaDownloadInProgress(): boolean {
  return isSdBulkDownloadInProgress() || isMediaAssetPoolDownloadInProgress();
}

/** Cancel media only — never touches OTA. */
export function cancelMediaDownloads(fileUrls?: string[]): void {
  requestSdCacheCancel(fileUrls);
  void cancelMediaAssetPoolFetch();
}

/** Clear stuck in-progress flags after absolute max age / forced interrupt. */
export function forceClearMediaDownloadLocks(reason: string): void {
  forceClearSdBulkDownloadLock(reason);
  forceClearMediaAssetPoolLock(reason);
}
