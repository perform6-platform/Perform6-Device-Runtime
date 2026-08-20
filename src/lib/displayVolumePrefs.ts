const DEFAULT_VOLUME = 0.5;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/** Full Program always starts at 50% unless a session is already in progress. */
export function getDefaultDisplayVolume(): number {
  return DEFAULT_VOLUME;
}

export function clampDisplayVolume(volume: number): number {
  return clampVolume(volume);
}

export { DEFAULT_VOLUME };
