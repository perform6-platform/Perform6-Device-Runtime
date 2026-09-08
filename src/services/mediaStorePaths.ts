/**
 * Single authoritative playable media store (BrightSign-aligned).
 *
 * - Playable: AssetPool GetPoolFilePath under perform6-media-pool (sha256-…, no copy)
 * - Legacy playable: /storage/sd/perform6-media/<name>.mp4 if still present
 * - Legacy dir perform6-cache is wiped on clear; not written anymore
 *
 * Node/JS always use /storage/sd/… ; BrightScript PlayFile uses SD:/…
 */

export const MEDIA_STORE_DIR_NAME = 'perform6-media';
export const MEDIA_POOL_DIR_NAME = 'perform6-media-pool';
export const LEGACY_CACHE_DIR_NAME = 'perform6-cache';

/** BrightScript / PlayFile root */
export const MEDIA_STORE_SD = `SD:/${MEDIA_STORE_DIR_NAME}`;
export const MEDIA_POOL_SD = `SD:/${MEDIA_POOL_DIR_NAME}`;
export const LEGACY_CACHE_SD = `SD:/${LEGACY_CACHE_DIR_NAME}`;

/** Working reserve for capacity gate (bytes) — downloads + filesystem headroom */
export const MEDIA_CAPACITY_RESERVE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export function mediaStoreFileSdPath(fileName: string): string {
  return `${MEDIA_STORE_SD}/${fileName}`;
}

export function mediaStoreFileUrl(fileName: string): string {
  return `file:///${MEDIA_STORE_SD}/${fileName}`;
}
