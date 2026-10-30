import { useEffect, useState } from 'react';
import type { PlaybackManifest } from '../shared/types';
import { runtimeConfig } from '../config/runtime';
import {
  areCriticalTouchContentReady,
  areTouchProgramsReady,
  countTouchProgramsReady,
  isTouchProgramSlotReady,
} from '../services/touchProgramGate';
import type { TouchPlaybackSlot } from '../services/playback';
import {
  getDownloadUiState,
  subscribeDownloadUi,
  type DownloadUiState,
} from '../services/downloadProgress';
import { hasSdCachedMedia, isSdBulkDownloadInProgress, subscribeSdCacheProgress } from '../services/sdCacheBridge';

const PROGRAM_RETRY_SYNC_MS = 60_000;

function simulatorPendingSlot(): TouchPlaybackSlot | null {
  if (!runtimeConfig.isSimulator || typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('p6PendingSlot');
  if (
    requested === 'start-here' ||
    requested === 'phase1' ||
    requested === 'phase2' ||
    requested === 'full-program'
  ) {
    return requested;
  }
  return null;
}

export function useTouchProgramGate(
  manifest: PlaybackManifest | null | undefined,
  runSyncNow?: () => Promise<void>,
) {
  const pendingSlot = simulatorPendingSlot();
  const [tick, setTick] = useState(0);
  const [downloadUi, setDownloadUi] = useState<DownloadUiState>(() => getDownloadUiState());

  useEffect(() => {
    return subscribeDownloadUi(setDownloadUi);
  }, []);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    return subscribeSdCacheProgress((event) => {
      if (
        event.status === 'done' ||
        event.status === 'skip' ||
        event.status === 'failed' ||
        event.status === 'cleared'
      ) {
        bump();
      }
    });
  }, []);

  const programsReady = runtimeConfig.isSimulator
    ? pendingSlot == null
    : areTouchProgramsReady(manifest);
  const criticalReady = runtimeConfig.isSimulator
    ? pendingSlot == null
    : areCriticalTouchContentReady(manifest);
  const showDownloadOverlay = !criticalReady;

  useEffect(() => {
    if (runtimeConfig.isSimulator || programsReady || !runSyncNow) return;

    const retry = () => {
      if (!isSdBulkDownloadInProgress()) {
        void runSyncNow();
      }
    };

    const id = window.setInterval(retry, PROGRAM_RETRY_SYNC_MS);
    return () => window.clearInterval(id);
  }, [programsReady, runSyncNow]);

  void tick;

  const counts = countTouchProgramsReady(manifest);
  const { ready, total } = pendingSlot ? { ready: 3, total: 4 } : counts;

  const isSlotReady = (slot: TouchPlaybackSlot) =>
    runtimeConfig.isSimulator
      ? slot !== pendingSlot
      : isTouchProgramSlotReady(manifest, slot);

  const effectiveDownloadUi: DownloadUiState = pendingSlot
    ? {
        phase: 'downloading',
        currentLabel: 'Preparing program media',
        completedFiles: 2,
        totalFiles: 4,
        cachePath: null,
        fileBytesDownloaded: 1_331_433_472,
        fileBytesTotal: 2_147_483_648,
        batchBytesDownloaded: 3_221_225_472,
        batchBytesTotal: 5_368_709_120,
        etaSeconds: 180,
        retryInSeconds: null,
        statusMessage: 'Downloading video to device',
      }
    : downloadUi;

  return {
    programsReady,
    showDownloadOverlay,
    downloadUi: effectiveDownloadUi,
    programsReadyCount: ready,
    programsTotalCount: total,
    isSlotReady,
    hasSdCachedMedia,
  };
}
