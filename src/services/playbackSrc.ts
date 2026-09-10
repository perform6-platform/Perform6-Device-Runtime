/**
 * Playback URL helpers — BrightAuthor-style offline play.
 * On BrightSign hardware: sync/AssetPool fills SD first, then local PlayFile / <video>.
 * Never stream HTTPS VOD on-device (no on-demand). Simulator may use remote URLs.
 */
import { runtimeConfig } from '../config/runtime';
import { MEDIA_POOL_DIR_NAME, MEDIA_STORE_DIR_NAME } from './mediaStorePaths';

export function isHttpUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  const lower = src.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export function isLocalPlaybackSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  if (src.startsWith('blob:')) return false;
  if (isHttpUrl(src)) return false;
  return true;
}

/**
 * BrightScript / roVideoPlayer path: SD:/perform6-media/….mp4
 * Accepts file:///SD:/…, file:///storage/sd/…, /storage/sd/…, or SD:/…
 */
export function toBrightSignSdPath(src: string | null | undefined): string {
  if (!src) return '';
  const trimmed = src.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('file:///SD:/') || trimmed.startsWith('file:///sd:/')) {
    return `SD:/${trimmed.slice('file:///SD:/'.length)}`;
  }
  if (trimmed.startsWith('file://SD:/') || trimmed.startsWith('file://sd:/')) {
    return `SD:/${trimmed.slice('file://SD:/'.length)}`;
  }
  if (trimmed.startsWith('file:///storage/sd/')) {
    return `SD:/${trimmed.slice('file:///storage/sd/'.length)}`;
  }
  if (trimmed.startsWith('file://storage/sd/')) {
    return `SD:/${trimmed.slice('file://storage/sd/'.length)}`;
  }
  if (trimmed.startsWith('/storage/sd/')) {
    return `SD:/${trimmed.slice('/storage/sd/'.length)}`;
  }
  if (/^sd:/i.test(trimmed)) {
    return `SD:/${trimmed.replace(/^sd:\/*/i, '')}`;
  }
  return trimmed;
}

/**
 * HtmlWidget <video> path: file:///SD:/perform6-media/….mp4
 */
export function toHtmlFileUrl(src: string | null | undefined): string {
  if (!src) return '';
  const trimmed = src.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file://')) return trimmed;

  const sd = toBrightSignSdPath(trimmed);
  if (sd.startsWith('SD:/')) {
    return `file:///${sd}`;
  }
  if (trimmed.startsWith('/storage/sd/')) {
    return `file:///SD:/${trimmed.slice('/storage/sd/'.length)}`;
  }
  return trimmed;
}

function hasVideoExtension(src: string): boolean {
  const lower = src.toLowerCase().split('?')[0] ?? '';
  return (
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.m4v') ||
    lower.endsWith('.webm')
  );
}

/**
 * Native LED PlayFile:
 * - SD:/perform6-media/*.mp4 (AssetRealizer output; field-proven native shape)
 * - SD:/perform6-media-pool/…/sha256-… only as a migration fallback. The
 *   XT2145 field player rejected this extensionless shape in PlayFile.
 */
export function isNativeLedPlayableSrc(src: string | null | undefined): boolean {
  if (!isLocalPlaybackSrc(src) || !src) return false;
  const sd = toBrightSignSdPath(src);
  const lower = sd.toLowerCase().split('?')[0] ?? '';
  if (!lower.startsWith('sd:/')) return false;
  if (lower.includes(MEDIA_POOL_DIR_NAME)) {
    return lower.length > `sd:/${MEDIA_POOL_DIR_NAME}/`.length;
  }
  void MEDIA_STORE_DIR_NAME;
  return hasVideoExtension(sd);
}

/**
 * LED / autorun PlayFile src — SD:/ path, normally perform6-media/*.mp4.
 */
export function toLedPlayableSrc(src: string | null | undefined): string {
  if (!isNativeLedPlayableSrc(src)) return '';
  return toBrightSignSdPath(src);
}

/**
 * BrightSign hardware never plays HTTPS VOD (no on-demand stream).
 * Local SD/cache path only; simulator may use remote URL for panes.
 */
export function resolvePlaybackSrc(
  localSrc: string | null | undefined,
  remoteSrc?: string | null,
): string | null {
  if (localSrc) return toHtmlFileUrl(localSrc) || localSrc;
  if (runtimeConfig.isSimulator && remoteSrc) return remoteSrc;
  return null;
}

/** Drop HTTPS on-device so HtmlWidget never creates a hidden decoder / on-demand stream. */
export function safeHtmlVideoSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  if (runtimeConfig.isSimulator) return src;
  if (isHttpUrl(src)) return null;
  const html = toHtmlFileUrl(src);
  return html || src;
}
