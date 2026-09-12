import { getSharedMessagePort } from '../platform/bsMessagePort';
import type { SyncMediaItem } from '../shared/types/api';

const META_KEY = 'perform6-encrypted-media-v1';

type EncryptionMap = Record<string, { algorithm: 'AesCtr' }>;

function validId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function validHex16(value: string): boolean {
  return /^[a-fA-F0-9]{32}$/.test(value);
}

function readMap(): EncryptionMap {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as EncryptionMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: EncryptionMap): void {
  localStorage.setItem(META_KEY, JSON.stringify(map));
}

/**
 * Install device-delivered keys into native registry. No key is persisted in
 * Chromium storage or logged. This does not touch playback, SD, OTA, or boot.
 */
export function stageEncryptedMediaKeys(items: SyncMediaItem[]): void {
  const port = getSharedMessagePort();
  const map = readMap();
  for (const item of items) {
    const encryption = item.encryption;
    if (!encryption) {
      continue;
    }
    if (
      encryption.algorithm !== 'AesCtr' ||
      !validId(item.mediaVersionId) ||
      !validHex16(encryption.keyHex) ||
      !validHex16(encryption.ivHex) ||
      !port
    ) {
      console.warn('[Perform6] MEDIA|KEY_STAGE|state=rejected|secretLogged=0', {
        mediaVersionId: item.mediaVersionId,
        controlPort: Boolean(port),
      });
      continue;
    }
    try {
      port.PostBSMessage({
        type: 'p6-media-key-store',
        assetId: item.mediaVersionId,
        algorithm: 'AesCtr',
        keyHex: encryption.keyHex,
        ivHex: encryption.ivHex,
      });
      console.info('[Perform6] MEDIA|KEY_STAGE|state=sent|secretLogged=0', {
        mediaVersionId: item.mediaVersionId,
      });
    } catch {
      console.warn('[Perform6] MEDIA|KEY_STAGE|state=failed|secretLogged=0', {
        mediaVersionId: item.mediaVersionId,
      });
    } finally {
      encryption.keyHex = '';
      encryption.ivHex = '';
    }
  }
  writeMap(map);
}

export function encryptionAssetId(mediaVersionId: string | null | undefined): string {
  if (!mediaVersionId) return '';
  return readMap()[mediaVersionId]?.algorithm === 'AesCtr' ? mediaVersionId : '';
}

/** Mark only after AssetPool download and realization have both succeeded. */
export function markEncryptedMediaCached(mediaVersionId: string): void {
  if (!validId(mediaVersionId)) return;
  const map = readMap();
  map[mediaVersionId] = { algorithm: 'AesCtr' };
  writeMap(map);
  window.dispatchEvent(
    new CustomEvent('perform6-encrypted-media-ready', {
      detail: { mediaVersionId },
    }),
  );
}

export function clearEncryptedMediaCached(mediaVersionIds: string[]): void {
  if (mediaVersionIds.length === 0) return;
  const map = readMap();
  for (const id of mediaVersionIds) delete map[id];
  writeMap(map);
}

export function encryptedCachedMediaVersionIds(confirmedIds: string[]): string[] {
  const confirmed = new Set(confirmedIds);
  return Object.keys(readMap()).filter((id) => confirmed.has(id));
}
