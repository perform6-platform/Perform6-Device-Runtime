import { runtimeConfig } from '../config/runtime';
import { CLUSTER_MEMBERS } from '../config/runtime';
import {
  fromBackendDisplayTarget,
  XC4055_HDMI_TARGETS,
  XC4055_SCREEN_FALLBACK_LABELS,
} from '../shared/displayTarget';
import type {
  BackendLogicalScreen,
  BackendPlaybackManifest,
  BackendTargetManifest,
  BackendTargetScreenContent,
  PlaybackSlotContent,
  PlaybackVideoItem,
  SyncCheckResponseData,
} from '../shared/types/api';
import type {
  ClusterMember,
  DisplayTarget,
  HardwareProfile,
  MediaAsset,
  PlaybackManifest,
  PlaybackScreen,
} from '../shared/types';

function isClusterMemberKey(value: string): value is ClusterMember {
  return (CLUSTER_MEMBERS as readonly string[]).includes(value);
}

function clusterMemberForScreenKey(screenKey: string | undefined): ClusterMember | undefined {
  if (!screenKey) return undefined;
  const match = /^SCREEN_(\d+)$/i.exec(screenKey);
  if (!match) return undefined;
  const index = Number(match[1]) - 1;
  return CLUSTER_MEMBERS[index];
}

function screenKeyForClusterMember(member: ClusterMember): DisplayTarget | undefined {
  const index = CLUSTER_MEMBERS.indexOf(member);
  if (index < 0) return undefined;
  return `SCREEN_${index + 1}` as DisplayTarget;
}

export function resolveMediaFileUrl(fileUrl: string): string {
  if (!fileUrl) return '';
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) return fileUrl;
  const apiOrigin = runtimeConfig.apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${apiOrigin}${fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`}`;
}

export function computeRotationDay(rotationStartDate?: string, fallbackDay = 1): number {
  if (!rotationStartDate) return fallbackDay;
  const start = new Date(rotationStartDate);
  const today = new Date();
  if (Number.isNaN(start.getTime())) return fallbackDay;
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  return (Math.max(diffDays, 0) % 36) + 1;
}

export function pickVideoForSlot(
  slot: PlaybackSlotContent | undefined,
  rotationDay: number,
): PlaybackVideoItem | null {
  const items = slot?.items ?? [];
  if (items.length === 0) return null;
  if (slot?.isRotating) {
    return items.find((i) => i.day === rotationDay) ?? items[0] ?? null;
  }
  return items[0] ?? null;
}

function videoItemToMediaAsset(item: PlaybackVideoItem): MediaAsset {
  const url = item.fileUrl ? resolveMediaFileUrl(item.fileUrl) : '';
  return {
    id: item.mediaVersionId ?? item.video ?? url,
    type: 'video',
    url,
    title: item.video ?? 'Video',
    durationSeconds: item.durationSeconds,
    loop: !item.day,
  };
}

function slotToScreen(
  id: string,
  label: string,
  slot: PlaybackSlotContent | undefined,
  rotationDay: number,
  extras?: { displayTarget?: DisplayTarget; clusterMember?: ClusterMember },
  /** Keep empty panes so XC4055 still shows the assigned category name. */
  allowEmpty = false,
): PlaybackScreen | null {
  const video = pickVideoForSlot(slot, rotationDay);
  // Offline playback only needs mediaVersionId; fileUrl is for cloud/fallback.
  const hasPlayable =
    Boolean(video?.mediaVersionId) ||
    Boolean(video?.fileUrl) ||
    Boolean(slot?.items?.some((item) => item.mediaVersionId || item.fileUrl));
  if (!hasPlayable && !allowEmpty) return null;

  const asset =
    video && (video.mediaVersionId || video.fileUrl)
      ? videoItemToMediaAsset(video)
      : null;
  const playlist = (slot?.items ?? [])
    .filter((item) => item.mediaVersionId || item.fileUrl)
    .map(videoItemToMediaAsset);

  return {
    id,
    label: slot?.label || label || id,
    displayTarget: extras?.displayTarget,
    clusterMember: extras?.clusterMember,
    currentVideo: asset ?? undefined,
    playlist: playlist.length > 0 ? playlist : asset ? [asset] : [],
    rotationDay,
  };
}

function isLogicalResolutionMode(mode: string | undefined): boolean {
  if (!mode) return false;
  const normalized = mode.toLowerCase();
  return (
    normalized === 'logical' ||
    normalized === 'logical-screen-map' ||
    normalized.includes('logical')
  );
}

function extractSlotContent(
  target: BackendTargetScreenContent | PlaybackSlotContent | undefined,
): PlaybackSlotContent | undefined {
  if (!target || typeof target !== 'object') return undefined;
  if ('slotContent' in target && target.slotContent) {
    return target.slotContent;
  }
  if ('items' in target || 'label' in target || 'isRotating' in target) {
    return target as PlaybackSlotContent;
  }
  return undefined;
}

function parseTargetManifest(
  targetManifest: BackendTargetManifest,
  rotationDay: number,
): PlaybackScreen[] {
  const targets = targetManifest.targets ?? {};
  const screens: PlaybackScreen[] = [];
  const usedClusterMembers = new Set<ClusterMember>();
  const usedTargets = new Set<DisplayTarget>();

  const pushScreen = (screen: PlaybackScreen | null) => {
    if (!screen) return;
    if (screen.clusterMember && usedClusterMembers.has(screen.clusterMember)) return;
    if (screen.displayTarget && usedTargets.has(screen.displayTarget)) return;
    if (screen.clusterMember) usedClusterMembers.add(screen.clusterMember);
    if (screen.displayTarget) usedTargets.add(screen.displayTarget);
    screens.push(screen);
  };

  // HD226 cluster targets are keyed by DEVICE_A / DEVICE_B / …
  for (const [key, target] of Object.entries(targets)) {
    const normalizedKey = key.toUpperCase();
    const targetKey =
      typeof target === 'object' && target && 'targetKey' in target
        ? String((target as BackendTargetScreenContent).targetKey ?? '').toUpperCase()
        : '';
    const memberKey = isClusterMemberKey(normalizedKey)
      ? normalizedKey
      : isClusterMemberKey(targetKey)
        ? targetKey
        : undefined;
    if (!memberKey) continue;

    const slot = extractSlotContent(target);
    const screenKey =
      typeof target === 'object' && target && 'screenKey' in target
        ? String((target as BackendTargetScreenContent).screenKey ?? '')
        : '';
    const displayTarget =
      fromBackendDisplayTarget(screenKey) ?? screenKeyForClusterMember(memberKey);

    pushScreen(
      slotToScreen(
        `hd226-${memberKey}`,
        slot?.label ?? memberKey,
        slot,
        rotationDay,
        { clusterMember: memberKey, displayTarget },
        true,
      ),
    );
  }

  const ensureScreen = (
    displayTarget: DisplayTarget,
    slot: PlaybackSlotContent | undefined,
    fallbackLabel: string,
    clusterMember?: ClusterMember,
  ) => {
    pushScreen(
      slotToScreen(
        `screen-${displayTarget}`,
        fallbackLabel,
        slot,
        rotationDay,
        {
          displayTarget,
          clusterMember:
            clusterMember ?? clusterMemberForScreenKey(displayTarget),
        },
        true,
      ),
    );
  };

  for (const hdmi of XC4055_HDMI_TARGETS) {
    const target = targets[hdmi];
    const displayTarget = fromBackendDisplayTarget(hdmi);
    if (!displayTarget) continue;
    const slot = extractSlotContent(target);
    const fallback =
      XC4055_SCREEN_FALLBACK_LABELS[displayTarget] ?? `Screen ${displayTarget}`;
    ensureScreen(displayTarget, slot, slot?.label ?? fallback);
  }

  // Also accept SCREEN_1 / SCREEN_2 keys if backend uses logical keys.
  for (const [key, target] of Object.entries(targets)) {
    const displayTarget = fromBackendDisplayTarget(key);
    if (!displayTarget) continue;
    const slot = extractSlotContent(target);
    ensureScreen(
      displayTarget,
      slot,
      slot?.label ?? XC4055_SCREEN_FALLBACK_LABELS[displayTarget] ?? key,
    );
  }

  // Prefer logical screens[] when HDMI shells are empty (e.g. bad displayTarget filter).
  const hasPlayable = screens.some(
    (s) => Boolean(s.currentVideo?.id) || (s.playlist?.length ?? 0) > 0,
  );
  if (
    !hasPlayable &&
    Array.isArray(targetManifest.screens) &&
    targetManifest.screens.length > 0
  ) {
    return parseXcLogicalScreens(
      targetManifest.screens as BackendLogicalScreen[],
      rotationDay,
    );
  }

  // Fallback: screens[] array on target manifest when no HDMI shells at all
  if (screens.length === 0 && Array.isArray(targetManifest.screens)) {
    return parseXcLogicalScreens(
      targetManifest.screens as BackendLogicalScreen[],
      rotationDay,
    );
  }

  return screens.sort((a, b) => {
    if (a.clusterMember && b.clusterMember) {
      return (
        CLUSTER_MEMBERS.indexOf(a.clusterMember) -
        CLUSTER_MEMBERS.indexOf(b.clusterMember)
      );
    }
    const order = { SCREEN_1: 1, SCREEN_2: 2, SCREEN_3: 3 } as const;
    return (order[a.displayTarget!] ?? 9) - (order[b.displayTarget!] ?? 9);
  });
}

/**
 * HD226 simulator / multi-player preview: build one screen per logical assignment
 * (SCREEN_1→DEVICE_A …) from the full screens[] payload.
 * Sync `targets` is intentionally filtered to the authenticated unit — screens[] is not.
 */
export function parseHdClusterScreens(
  logicalScreens: BackendLogicalScreen[],
  rotationDay: number,
): PlaybackScreen[] {
  const screens: PlaybackScreen[] = [];
  const usedMembers = new Set<ClusterMember>();

  const ordered = [...logicalScreens].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  for (const logical of ordered) {
    const member = clusterMemberForScreenKey(logical.screenKey);
    if (!member || usedMembers.has(member)) continue;

    const displayTarget =
      (logical.screenKey
        ? fromBackendDisplayTarget(logical.screenKey)
        : undefined) ?? screenKeyForClusterMember(member);

    const screen = slotToScreen(
      `hd226-${member}`,
      logical.slotContent?.label ?? member,
      logical.slotContent,
      rotationDay,
      { clusterMember: member, displayTarget },
      true,
    );
    if (!screen) continue;
    usedMembers.add(member);
    screens.push(screen);
  }

  return screens;
}

/**
 * XC4055 multi-pane / simulator: build SCREEN_1–3 from logical screens[] when
 * sync `targets` is empty or filtered to a single HDMI port.
 */
export function parseXcLogicalScreens(
  logicalScreens: BackendLogicalScreen[],
  rotationDay: number,
): PlaybackScreen[] {
  const screens: PlaybackScreen[] = [];
  const usedTargets = new Set<DisplayTarget>();

  const ordered = [...logicalScreens].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  for (const logical of ordered) {
    const displayTarget = logical.screenKey
      ? fromBackendDisplayTarget(logical.screenKey)
      : undefined;
    if (!displayTarget || usedTargets.has(displayTarget)) continue;

    const screen = slotToScreen(
      `screen-${displayTarget}`,
      logical.slotContent?.label ??
        XC4055_SCREEN_FALLBACK_LABELS[displayTarget] ??
        logical.screenKey ??
        displayTarget,
      logical.slotContent,
      rotationDay,
      {
        displayTarget,
        clusterMember: clusterMemberForScreenKey(logical.screenKey),
      },
      true,
    );
    if (!screen) continue;
    usedTargets.add(displayTarget);
    screens.push(screen);
  }

  return screens;
}

/** Map ScreenContentSlot / ContentSlot / SCREEN_N → touch UI slot ids. */
function xtTouchSlotId(logical: BackendLogicalScreen): string | undefined {
  const raw = (logical.contentSlot ?? logical.legacySlot ?? '').trim();
  const slot = raw.toUpperCase().replace(/[\s-]/g, '_');
  // ScreenContentSlot: DEFAULT / START_HERE / …
  // ContentSlot camelCase uppercased: STARTHERE / PHASE1 / FULLPROGRAM
  switch (slot) {
    case 'DEFAULT':
      return 'touch-default';
    case 'START_HERE':
    case 'STARTHERE':
      return 'start-here';
    case 'PHASE_1':
    case 'PHASE1':
      return 'phase1';
    case 'PHASE_2':
    case 'PHASE2':
      return 'phase2';
    case 'FULL_PROGRAM':
    case 'FULLPROGRAM':
      return 'full-program';
    default:
      break;
  }

  switch ((logical.screenKey ?? '').toUpperCase()) {
    case 'SCREEN_1':
      return 'touch-default';
    case 'SCREEN_2':
      return 'start-here';
    case 'SCREEN_3':
      return 'phase1';
    case 'SCREEN_4':
      return 'phase2';
    case 'SCREEN_5':
      return 'full-program';
    default:
      return undefined;
  }
}

/**
 * XT2145 touch UI looks up fixed slot ids (touch-default, start-here, …).
 * Hardware-abstraction sync returns logical screens[] with contentSlot +
 * targets.TOUCH_MAIN — never treat that as XC HDMI panes.
 */
export function parseXtTouchScreens(
  logicalScreens: BackendLogicalScreen[],
  rotationDay: number,
): PlaybackScreen[] {
  const screens: PlaybackScreen[] = [];
  const used = new Set<string>();
  const ordered = [...logicalScreens].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  for (const logical of ordered) {
    const id = xtTouchSlotId(logical);
    if (!id || used.has(id)) continue;
    const screen = slotToScreen(
      id,
      logical.slotContent?.label ?? id,
      logical.slotContent,
      rotationDay,
    );
    if (!screen) continue;
    used.add(id);
    screens.push(screen);
  }

  return screens;
}

/** Prefer category screens[]; fill any missing touch slots from legacy content{}. */
function mergeXtTouchScreens(
  primary: PlaybackScreen[],
  fallback: PlaybackScreen[],
): PlaybackScreen[] {
  const byId = new Map<string, PlaybackScreen>();
  for (const screen of fallback) byId.set(screen.id, screen);
  for (const screen of primary) byId.set(screen.id, screen);
  const order = [
    'touch-default',
    'start-here',
    'phase1',
    'phase2',
    'full-program',
  ];
  // Do not invent DEFAULT from other slots — idle must be the DB DEFAULT category.
  return order
    .map((id) => byId.get(id))
    .filter((s): s is PlaybackScreen => Boolean(s));
}

function manifestToScreens(
  manifest: BackendPlaybackManifest,
  profile: HardwareProfile,
): PlaybackScreen[] {
  const rotationDay =
    manifest.rotationDay ?? computeRotationDay(manifest.rotationStartDate);
  const content = manifest.content ?? {};
  const screens: PlaybackScreen[] = [];

  if (profile === 'XT2145') {
    const slots: Array<[string, PlaybackSlotContent | undefined]> = [
      // Only the DEFAULT content slot — never substitute startHere (that is a different program).
      ['touch-default', content.default],
      ['start-here', content.startHere],
      ['phase1', content.phase1],
      ['phase2', content.phase2],
      ['full-program', content.fullProgram],
    ];
    for (const [id, slot] of slots) {
      const screen = slotToScreen(id, slot?.label ?? id, slot, rotationDay);
      if (screen) screens.push(screen);
    }
    return screens.length > 0 ? screens : [];
  }

  // If logical screens are embedded on the playback manifest, prefer them.
  if (Array.isArray(manifest.screens) && manifest.screens.length > 0) {
    return parseTargetManifest(
      { targets: {}, screens: manifest.screens },
      rotationDay,
    );
  }

  if (manifest.targets && Object.keys(manifest.targets).length > 0) {
    return parseTargetManifest({ targets: manifest.targets }, rotationDay);
  }

  const defaultSlots: Array<[DisplayTarget, string, PlaybackSlotContent | undefined]> = [
    ['SCREEN_1', 'Start Here', content.startHere ?? content.default],
    ['SCREEN_2', 'Phase 1', content.phase1],
    ['SCREEN_3', 'Phase 2', content.phase2],
  ];

  for (const [target, label, slot] of defaultSlots) {
    const screen = slotToScreen(`screen-${target}`, slot?.label ?? label, slot, rotationDay, {
      displayTarget: target,
    }, true);
    if (screen) screens.push(screen);
  }

  return screens;
}

export function buildRuntimeManifest(
  syncData: SyncCheckResponseData,
  profile: HardwareProfile,
): PlaybackManifest | null {
  const rotationDay =
    syncData.device?.currentRotationDay ??
    computeRotationDay(syncData.device?.rotationStartDate);

  let screens: PlaybackScreen[] = [];

  const targetManifest = syncData.targetManifest;
  const playbackAsTarget =
    syncData.playbackManifest &&
    (syncData.playbackManifest.targets || syncData.playbackManifest.screens)
      ? syncData.playbackManifest
      : null;

  const logicalScreens =
    targetManifest?.screens ??
    playbackAsTarget?.screens ??
    [];

  // XC4055 / HD226: prefer full logical screens so multi-pane sims preview every
  // output (targets may be filtered to a single HDMI / cluster member).
  // XT2145: touch slot ids only — never parse TOUCH_MAIN as HDMI panes.
  if (profile === 'XC4055' && logicalScreens.length > 0) {
    screens = parseXcLogicalScreens(logicalScreens, rotationDay);
  } else if (profile === 'HD226' && logicalScreens.length > 0) {
    screens = parseHdClusterScreens(logicalScreens, rotationDay);
  } else if (profile === 'XT2145') {
    const fromLogical =
      logicalScreens.length > 0
        ? parseXtTouchScreens(logicalScreens, rotationDay)
        : [];
    const fromContent = syncData.playbackManifest
      ? manifestToScreens(syncData.playbackManifest, profile)
      : [];
    screens = mergeXtTouchScreens(fromLogical, fromContent);
  }

  const hasTargetPayload = Boolean(
    targetManifest?.targets && Object.keys(targetManifest.targets).length > 0,
  );
  const hasLogicalScreens = logicalScreens.length > 0;

  if (
    screens.length === 0 &&
    (profile === 'XC4055' || profile === 'HD226') &&
    (isLogicalResolutionMode(syncData.config?.resolutionMode) ||
      hasTargetPayload ||
      hasLogicalScreens) &&
    targetManifest
  ) {
    screens = parseTargetManifest(targetManifest, rotationDay);
  } else if (screens.length === 0 && syncData.playbackManifest) {
    // Same payload sometimes only on playbackManifest when targetManifest aliases it.
    const pm = syncData.playbackManifest;
    if (pm.targets && Object.keys(pm.targets).length > 0) {
      screens = parseTargetManifest(
        { targets: pm.targets, screens: pm.screens },
        rotationDay,
      );
    } else {
      screens = manifestToScreens(pm, profile);
    }
  }

  if (screens.length === 0) return null;

  const deployment = syncData.deployment;
  const pm = syncData.playbackManifest;

  return {
    version: syncData.syncJobId,
    updatedAt: new Date().toISOString(),
    deployment: {
      id: syncData.device?.id ?? 'unknown',
      name: deployment?.deploymentType ?? 'Deployment',
      libraryId: deployment?.fieldCategory ?? '',
      libraryName:
        screens[0]?.label ||
        `${deployment?.fieldCategory ?? ''} ${deployment?.exerciseVariant ?? ''}`.trim() ||
        'Deployment',
      currentDay: rotationDay,
      totalDays: 36,
      brandingUrl: pm?.branding?.logoUrl,
      rotationId: syncData.device?.rotationStartDate,
    },
    screens,
  };
}

export function getCachedMediaVersionIds(): string[] {
  try {
    const raw = localStorage.getItem('perform6-cached-media-ids');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function persistCachedMediaVersionIds(ids: string[]): void {
  localStorage.setItem('perform6-cached-media-ids', JSON.stringify(ids));
}

/** Wipe reported cache IDs so a fresh re-pair / profile session does not skip downloads. */
export function clearCachedMediaVersionIds(): void {
  localStorage.removeItem('perform6-cached-media-ids');
}

export function addCachedMediaVersionId(id: string): void {
  const ids = getCachedMediaVersionIds();
  if (!ids.includes(id)) {
    persistCachedMediaVersionIds([...ids, id]);
  }
}

export function removeCachedMediaVersionIds(idsToRemove: string[]): void {
  if (idsToRemove.length === 0) return;
  const removeSet = new Set(idsToRemove);
  persistCachedMediaVersionIds(getCachedMediaVersionIds().filter((id) => !removeSet.has(id)));
}
