import type { PlaybackManifest } from '../shared/types';
import { findTouchScreen, getCurrentVideo, type TouchPlaybackSlot } from './playback';
import { hasSdCachedMedia } from './sdCacheBridge';

/** Touch program buttons — idle is excluded (plays while these download). */
export const TOUCH_PROGRAM_SLOTS: TouchPlaybackSlot[] = [
  'start-here',
  'phase1',
  'phase2',
  'full-program',
];

export const TOUCH_SLOT_LABELS: Record<TouchPlaybackSlot, string> = {
  'touch-default': 'Idle',
  'start-here': 'Start Here',
  phase1: 'Phase 1',
  phase2: 'Phase 2',
  'full-program': 'Full Program',
};

export interface TouchProgramSlotInfo {
  slot: TouchPlaybackSlot;
  label: string;
  mediaVersionId: string | null;
  fileSize: number;
  assigned: boolean;
  cached: boolean;
}

export function listTouchProgramSlots(
  manifest: PlaybackManifest | null | undefined,
): TouchProgramSlotInfo[] {
  return TOUCH_PROGRAM_SLOTS.map((slot) => {
    const screen = manifest ? findTouchScreen(manifest, slot) : undefined;
    const video = getCurrentVideo(screen);
    const mediaVersionId = video?.id ?? null;
    const assigned = Boolean(mediaVersionId && video?.url);
    const cached = mediaVersionId ? hasSdCachedMedia(mediaVersionId) : true;
    return {
      slot,
      label: video?.title?.trim() || TOUCH_SLOT_LABELS[slot],
      mediaVersionId,
      fileSize: 0,
      assigned,
      cached,
    };
  });
}

export function countTouchProgramsReady(
  manifest: PlaybackManifest | null | undefined,
): { ready: number; total: number; slots: TouchProgramSlotInfo[] } {
  const slots = listTouchProgramSlots(manifest);
  const assigned = slots.filter((s) => s.assigned);
  const ready = assigned.filter((s) => s.cached).length;
  return { ready, total: assigned.length, slots };
}

export function areTouchProgramsReady(
  manifest: PlaybackManifest | null | undefined,
): boolean {
  const { ready, total } = countTouchProgramsReady(manifest);
  return total === 0 || ready >= total;
}

export function isTouchProgramSlotReady(
  manifest: PlaybackManifest | null | undefined,
  slot: TouchPlaybackSlot,
): boolean {
  const screen = manifest ? findTouchScreen(manifest, slot) : undefined;
  const video = getCurrentVideo(screen);
  if (!video?.id || !video.url) return true;
  return hasSdCachedMedia(video.id);
}

export function touchProgramMediaVersionIds(
  manifest: PlaybackManifest | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!manifest) return ids;
  for (const slot of TOUCH_PROGRAM_SLOTS) {
    const screen = findTouchScreen(manifest, slot);
    const video = getCurrentVideo(screen);
    if (video?.id) ids.add(video.id);
  }
  return ids;
}

export function labelForMediaVersionId(
  manifest: PlaybackManifest | null | undefined,
  mediaVersionId: string,
): string {
  for (const slot of ['touch-default', ...TOUCH_PROGRAM_SLOTS] as TouchPlaybackSlot[]) {
    const screen = manifest ? findTouchScreen(manifest, slot) : undefined;
    const video = getCurrentVideo(screen);
    if (video?.id === mediaVersionId) {
      return video.title?.trim() || TOUCH_SLOT_LABELS[slot];
    }
  }
  return 'Video';
}
