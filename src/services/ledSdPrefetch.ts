import { runtimeConfig } from '../config/runtime';
import type { SyncCheckResponseData } from '../shared/types/api';
import { resolveMediaFileUrl } from './manifest';

const PREFETCH_MESSAGE = 'led-cache-prefetch';

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const ctor = window.BSMessagePort;
    return typeof ctor === 'function' ? new ctor() : null;
  } catch {
    return null;
  }
}

/** Absolute http(s) URLs the native LED player should keep on SD. */
export function collectLedPrefetchUrls(
  syncData: SyncCheckResponseData | null | undefined,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const item of syncData?.media ?? []) {
    if (!item.fileUrl) continue;
    const resolved = resolveMediaFileUrl(item.fileUrl);
    if (!resolved.startsWith('http://') && !resolved.startsWith('https://')) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
  }

  return urls;
}

/**
 * Ask autorun.brs to download these URLs into SD:/perform6-cache before play.
 * No-op in simulator / browser / HD226 (HtmlWidget-only).
 */
export function requestLedSdPrefetch(urls: string[]): void {
  if (runtimeConfig.isSimulator) return;
  if (
    runtimeConfig.hardwareProfile !== 'XT2145' &&
    runtimeConfig.hardwareProfile !== 'XC4055'
  ) {
    return;
  }
  if (runtimeConfig.xtOutputRole === 'led') return;
  if (
    runtimeConfig.hardwareProfile === 'XC4055' &&
    runtimeConfig.xcOutputRole !== 'primary'
  ) {
    return;
  }

  const unique = [...new Set(urls.filter((u) => u.startsWith('http')))];
  if (unique.length === 0) return;

  const port = createMessagePort();
  if (!port) {
    console.warn('[Perform6] LED SD prefetch skipped — BSMessagePort missing');
    return;
  }

  // Flat string payload — BrightScript PayloadString only sees simple fields.
  port.PostBSMessage({
    type: PREFETCH_MESSAGE,
    role: runtimeConfig.hardwareProfile === 'XC4055' ? 'primary' : 'touch',
    urls: unique.join('|'),
    count: String(unique.length),
  });

  console.info('[Perform6] LED SD prefetch requested', { count: unique.length });
}

export function prefetchLedSdFromSync(
  syncData: SyncCheckResponseData | null | undefined,
): void {
  requestLedSdPrefetch(collectLedPrefetchUrls(syncData));
}
