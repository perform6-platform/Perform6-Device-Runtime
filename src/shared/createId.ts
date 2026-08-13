/**
 * BrightSign Chromium often lacks crypto.randomUUID (added in newer browsers).
 * Use native when present; otherwise a compact unique-enough id for logs/UI keys.
 */
export function createId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    /* fall through */
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
