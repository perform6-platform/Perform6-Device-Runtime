/** Compare dotted runtime versions (e.g. 1.0.66). Returns 1 / 0 / -1. */
export function compareRuntimeVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isRuntimeNewerOrEqual(current: string, target: string): boolean {
  return compareRuntimeVersions(current, target) >= 0;
}
