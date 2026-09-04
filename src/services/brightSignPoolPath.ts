/**
 * BrightSign AssetPool constructor paths.
 * Prefer `/storage/sd/…` (works on OS 9.1 Strata / XT2145). Docs-style `sd/…`
 * is a fallback only. Never use `SD:/…` or `sd:/…` for AssetPool — those log
 * "File not accessible: /SD:" / "/sd:/…" and fail the constructor.
 * Autorun wipe paths stay SD:/perform6-media-pool and SD:/perform6-ota-pool.
 */
export function brightSignAssetPoolDir(folderName: string): string {
  const cleaned = folderName
    .replace(/^\/+/, '')
    .replace(/^storage\/sd\//i, '')
    .replace(/^sd:\//i, '')
    .replace(/^sd\//i, '');
  return `/storage/sd/${cleaned}`;
}

/** Docs-style fallback if `/storage/sd/…` is rejected on older OS builds. */
export function brightSignAssetPoolDirDocs(folderName: string): string {
  const cleaned = folderName
    .replace(/^\/+/, '')
    .replace(/^storage\/sd\//i, '')
    .replace(/^sd:\//i, '')
    .replace(/^sd\//i, '');
  return `sd/${cleaned}`;
}

export const MEDIA_ASSET_POOL_DIR = brightSignAssetPoolDir('perform6-media-pool');
export const OTA_ASSET_POOL_DIR = brightSignAssetPoolDir('perform6-ota-pool');
export const MEDIA_ASSET_POOL_DIR_DOCS = brightSignAssetPoolDirDocs('perform6-media-pool');
export const OTA_ASSET_POOL_DIR_DOCS = brightSignAssetPoolDirDocs('perform6-ota-pool');

/** Bump when pool path format changes so stale localStorage marks are dropped. */
export const MEDIA_POOL_MARKS_VERSION = '3-storage-sd';
