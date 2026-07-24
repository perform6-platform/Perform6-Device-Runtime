export interface ScreenPlaybackSample {
  screenKey: string;
  mediaVersionId?: string | null;
  title?: string | null;
  positionMs: number;
  durationMs?: number | null;
  isPlaying: boolean;
}

const samples = new Map<string, ScreenPlaybackSample>();

/** Upsert the latest playhead for a logical screen (HDMI / touch slot). */
export function reportScreenPlayback(sample: ScreenPlaybackSample): void {
  if (!sample.screenKey) return;
  samples.set(sample.screenKey, {
    ...sample,
    positionMs: Math.max(0, Math.round(sample.positionMs)),
    durationMs:
      sample.durationMs != null && Number.isFinite(sample.durationMs)
        ? Math.max(0, Math.round(sample.durationMs))
        : null,
  });
}

export function clearScreenPlayback(screenKey: string): void {
  samples.delete(screenKey);
}

export function getPlaybackTelemetrySnapshot(): ScreenPlaybackSample[] {
  return Array.from(samples.values());
}
