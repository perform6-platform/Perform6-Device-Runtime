import type { PlaybackManifest } from '../shared/types';

const KEY = 'perform6-playback-manifest';

/** Persist last successful sync manifest so UI can play SD-cached clips offline after reboot. */
export function savePlaybackManifestCache(manifest: PlaybackManifest): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        manifest,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadPlaybackManifestCache(): PlaybackManifest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { manifest?: PlaybackManifest };
    if (!parsed?.manifest?.screens || !Array.isArray(parsed.manifest.screens)) {
      return null;
    }
    return parsed.manifest;
  } catch {
    return null;
  }
}

export function clearPlaybackManifestCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
