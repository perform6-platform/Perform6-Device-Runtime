const VOLUME_KEY = 'perform6-display-volume';
const DEFAULT_VOLUME = 0.5;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/** Last user-selected LED volume (0–1). Defaults to 50%. */
export function readStoredDisplayVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    return clampVolume(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function writeStoredDisplayVolume(volume: number): void {
  try {
    const next = clampVolume(volume);
    if (next > 0) {
      localStorage.setItem(VOLUME_KEY, String(next));
    }
  } catch {
    // BrightSign / private mode — ignore.
  }
}

export { DEFAULT_VOLUME };
