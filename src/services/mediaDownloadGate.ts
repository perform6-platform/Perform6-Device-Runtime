/**
 * Single gate for "media download in progress" across asset pool + autorun cache.
 * Keeps OTA free to run without sharing this flag.
 */
import { isSdBulkDownloadInProgress, requestSdCacheCancel } from './sdCacheBridge';
import {
  cancelMediaAssetPoolFetch,
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
