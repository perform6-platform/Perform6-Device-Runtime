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

export function useTouchProgramGate(
  manifest: PlaybackManifest | null | undefined,
  runSyncNow?: () => Promise<void>,
) {
  const [tick, setTick] = useState(0);
  const [downloadUi, setDownloadUi] = useState<DownloadUiState>(() => getDownloadUiState());

  useEffect(() => {
    return subscribeDownloadUi(setDownloadUi);
  }, []);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    return subscribeSdCacheProgress((event) => {
      if (event.status === 'done' || event.status === 'skip' || event.status === 'failed') {
        bump();
      }
    });
  }, []);

  const programsReady = runtimeConfig.isSimulator || areTouchProgramsReady(manifest);
  const criticalReady = runtimeConfig.isSimulator || areCriticalTouchContentReady(manifest);
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

  const { ready, total } = countTouchProgramsReady(manifest);

  const isSlotReady = (slot: TouchPlaybackSlot) =>
    runtimeConfig.isSimulator || isTouchProgramSlotReady(manifest, slot);

  return {
    programsReady,
    showDownloadOverlay,
    downloadUi,
    programsReadyCount: ready,
    programsTotalCount: total,
    isSlotReady,
    hasSdCachedMedia,
  };
}
