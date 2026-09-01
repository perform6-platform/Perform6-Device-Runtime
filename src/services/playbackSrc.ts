import { runtimeConfig } from '../config/runtime';

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
 * BrightSign hardware never plays HTTPS VOD (dual-decode + cache fight).
 * The browser simulator may use the remote URL so panes are not blank.
 */
export function resolvePlaybackSrc(
  localSrc: string | null | undefined,
  remoteSrc?: string | null,
): string | null {
  if (localSrc) return localSrc;
  if (runtimeConfig.isSimulator && remoteSrc) return remoteSrc;
  return null;
}

/** Drop HTTPS on-device so HtmlWidget never creates a hidden decoder. */
export function safeHtmlVideoSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  if (runtimeConfig.isSimulator) return src;
  if (isHttpUrl(src)) return null;
  return src;
}
