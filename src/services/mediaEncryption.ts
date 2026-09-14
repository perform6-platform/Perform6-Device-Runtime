import { getSharedMessagePort } from '../platform/bsMessagePort';
import type { SyncMediaItem } from '../shared/types/api';

const META_KEY = 'perform6-encrypted-media-v1';

type EncryptionMap = Record<string, { algorithm: 'AesCtr' }>;

type HtmlPlaybackEncryption = {
  algorithm: 'AesCtr';
  /** BrightSign HTML video expects the 128-bit key followed by the 128-bit IV. */
  keyAndIvHex: string;
};

// Intentionally process-memory only. BrightSign's HTML video element needs the
// material while opening an encrypted file, but it must never enter Chromium
// storage or logs.
const htmlPlaybackKeys = new Map<string, HtmlPlaybackEncryption>();

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
      !validHex16(encryption.ivHex)
    ) {
      console.warn('[Perform6] MEDIA|KEY_STAGE|state=rejected|secretLogged=0', {
        mediaVersionId: item.mediaVersionId,
        controlPort: Boolean(port),
      });
      continue;
    }
    htmlPlaybackKeys.set(item.mediaVersionId, {
      algorithm: 'AesCtr',
      keyAndIvHex: encryption.keyHex + encryption.ivHex,
    });
    window.dispatchEvent(
      new CustomEvent('perform6-encryption-key-staged', {
        detail: { mediaVersionId: item.mediaVersionId },
      }),
    );
    if (!port) {
      console.warn('[Perform6] MEDIA|KEY_STAGE|state=rejected|secretLogged=0', {
        mediaVersionId: item.mediaVersionId,
        controlPort: false,
      });
      encryption.keyHex = '';
      encryption.ivHex = '';
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

export function htmlPlaybackEncryption(
  mediaVersionId: string | null | undefined,
): HtmlPlaybackEncryption | null {
  if (!mediaVersionId || readMap()[mediaVersionId]?.algorithm !== 'AesCtr') {
    return null;
  }
  return htmlPlaybackKeys.get(mediaVersionId) ?? null;
}

/** Mark only after AssetPool download and realization have both succeeded. */
export function markEncryptedMediaCached(mediaVersionId: string): void {
  if (!validId(mediaVersionId)) return;
  const map = readMap();
  const alreadyMarked = map[mediaVersionId]?.algorithm === 'AesCtr';
  map[mediaVersionId] = { algorithm: 'AesCtr' };
  writeMap(map);
  if (alreadyMarked) return;
  window.dispatchEvent(
    new CustomEvent('perform6-encrypted-media-ready', {
      detail: { mediaVersionId },
    }),
  );
}

export function clearEncryptedMediaCached(mediaVersionIds: string[]): void {
  if (mediaVersionIds.length === 0) return;
  const map = readMap();
  for (const id of mediaVersionIds) {
    delete map[id];
    htmlPlaybackKeys.delete(id);
  }
  writeMap(map);
}

export function encryptedCachedMediaVersionIds(confirmedIds: string[]): string[] {
  const confirmed = new Set(confirmedIds);
  return Object.keys(readMap()).filter((id) => confirmed.has(id));
}
