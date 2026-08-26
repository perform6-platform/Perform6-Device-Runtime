/**
 * Must match brightsign/autorun.brs SimpleHash + CacheNameFor exactly.
 * Same HTTPS URL → same SD:/perform6-cache filename on every profile.
 */

export function simpleHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 33 + text.charCodeAt(i)) % 10_000_000;
  }
  return `${h}-${text.length}`;
}

export function urlExtension(url: string): string {
  let base = url;
  const q = base.indexOf('?');
  if (q >= 0) base = base.slice(0, q);
  let dot = -1;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    const ch = base[i];
    if (ch === '.') {
      dot = i;
      break;
    }
    if (ch === '/') break;
  }
  if (dot >= 0) {
    const ext = base.slice(dot).toLowerCase();
    if (ext.length >= 3 && ext.length <= 5) return ext;
  }
  return '.mp4';
}

export function cacheNameFor(url: string): string {
  return simpleHash(url) + urlExtension(url);
}

/** HtmlWidget-local path for a cached media file. */
export function sdCacheFileUrl(url: string): string {
  return `file:///SD:/perform6-cache/${cacheNameFor(url)}`;
}
