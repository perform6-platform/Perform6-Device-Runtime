import { create } from 'zustand';
import type {
  ConnectionStatus,
  DebugLogEntry,
  DeviceInfo,
  PlaybackManifest,
  PlaybackState,
  SyncState,
} from '../shared/types';
import { createId } from '../shared/createId';

interface RuntimeStoreState {
  deviceInfo: DeviceInfo | null;
  connectionStatus: ConnectionStatus;
  syncState: SyncState;
  playbackState: PlaybackState;
  lastHeartbeatAt: string | null;
  heartbeatOk: boolean;
  startedAt: number;
  debugLogs: DebugLogEntry[];
  displayVideoSrc: string | null;
  displayPlaybackMeta: {
    screenKey: string;
    mediaVersionId: string | null;
    title: string | null;
  } | null;
  displayPaused: boolean;
  displayMuted: boolean;
  displayVolume: number;
  displayRestartNonce: number;
  displayVideoLoop: boolean;
  /** Fired when a non-looping display video reaches ended (touch Full Program). */
  displayVideoEndedHandler: (() => void) | null;
  simulatorSessionActive: boolean;
  pendingRoute: string | null;
  /** On-device startup lines shown until pairing UI is ready */
  bootLines: string[];
  setDeviceInfo: (info: DeviceInfo) => void;
  setSimulatorSession: (payload: { active: boolean; pendingRoute?: string | null }) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setSyncState: (partial: Partial<SyncState>) => void;
  setPlaybackManifest: (manifest: PlaybackManifest | null) => void;
  setDisplayVideoSrc: (
    src: string | null,
    meta?: {
      screenKey?: string;
      mediaVersionId?: string | null;
      title?: string | null;
    } | null,
  ) => void;
  resetDisplayControls: () => void;
  toggleDisplayPaused: () => void;
  toggleDisplayMuted: () => void;
  setDisplayVolume: (volume: number) => void;
  setDisplayVideoLoop: (loop: boolean) => void;
  setDisplayPaused: (paused: boolean) => void;
  setDisplayVideoEndedHandler: (handler: (() => void) | null) => void;
  restartDisplayVideo: () => void;
  setPlaybackPlaying: (isPlaying: boolean) => void;
  setHeartbeat: (payload: { at: string; ok: boolean }) => void;
  pushDebugLog: (entry: Omit<DebugLogEntry, 'id' | 'timestamp'>) => void;
  pushBootLine: (line: string) => void;
  clearDebugLogs: () => void;
}

const emptySync: SyncState = {
  lastCheckAt: null,
  lastSyncAt: null,
  syncJobId: null,
  configVersion: null,
  manifestVersion: null,
  syncRequired: false,
  inProgress: false,
  error: null,
  runtimePhase: 'unpaired',
  credentialsFetching: false,
  credentialsError: null,
};

const emptyPlayback: PlaybackState = {
  manifest: null,
  currentScreenId: null,
  currentVideo: null,
  isPlaying: true,
  displayVideoSrc: null,
};

export const useRuntimeStore = create<RuntimeStoreState>((set, get) => ({
  deviceInfo: null,
  connectionStatus: 'connecting',
  syncState: emptySync,
  playbackState: emptyPlayback,
  lastHeartbeatAt: null,
  heartbeatOk: false,
  startedAt: Date.now(),
  debugLogs: [],
  displayVideoSrc: null,
  displayPlaybackMeta: null,
  displayPaused: false,
  displayMuted: true,
  displayVolume: 1,
  displayRestartNonce: 0,
  displayVideoLoop: true,
  displayVideoEndedHandler: null,
  simulatorSessionActive: false,
  pendingRoute: null,
  bootLines: ['Perform6 runtime starting…'],
  setDeviceInfo: (deviceInfo) => set({ deviceInfo }),
  setSimulatorSession: ({ active, pendingRoute = null }) =>
    set({
      simulatorSessionActive: active,
      pendingRoute: active ? pendingRoute : null,
    }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setSyncState: (partial) => set({ syncState: { ...get().syncState, ...partial } }),
  setPlaybackManifest: (manifest) =>
    set({
      playbackState: {
        ...get().playbackState,
        manifest,
        currentVideo: manifest?.screens[0]?.currentVideo ?? null,
        currentScreenId: manifest?.screens[0]?.id ?? null,
      },
    }),
  setDisplayVideoSrc: (displayVideoSrc, meta) =>
    set({
      displayVideoSrc,
      displayPlaybackMeta: displayVideoSrc
        ? {
            screenKey: meta?.screenKey ?? 'SCREEN_1',
            mediaVersionId: meta?.mediaVersionId ?? null,
            title: meta?.title ?? null,
          }
        : null,
    }),
  resetDisplayControls: () =>
    set({
      displayPaused: false,
      displayMuted: true,
      displayVolume: 1,
      displayRestartNonce: 0,
      displayVideoLoop: true,
    }),
  toggleDisplayPaused: () => {
    const displayPaused = !get().displayPaused;
    set({ displayPaused });
    set({ playbackState: { ...get().playbackState, isPlaying: !displayPaused } });
  },
  toggleDisplayMuted: () => {
    const state = get();
    if (state.displayMuted) {
      set({
        displayMuted: false,
        displayVolume: state.displayVolume > 0 ? state.displayVolume : 1,
      });
      return;
    }
    set({ displayMuted: true });
  },
  setDisplayVolume: (displayVolume) =>
    set({
      displayVolume,
      displayMuted: displayVolume === 0,
    }),
  setDisplayVideoLoop: (displayVideoLoop) => set({ displayVideoLoop }),
  setDisplayPaused: (displayPaused) => {
    set({ displayPaused });
    set({ playbackState: { ...get().playbackState, isPlaying: !displayPaused } });
  },
  setDisplayVideoEndedHandler: (displayVideoEndedHandler) => set({ displayVideoEndedHandler }),
  restartDisplayVideo: () =>
    set({ displayRestartNonce: get().displayRestartNonce + 1, displayPaused: false }),
  setPlaybackPlaying: (isPlaying) =>
    set({ playbackState: { ...get().playbackState, isPlaying } }),
  setHeartbeat: ({ at, ok }) => set({ lastHeartbeatAt: at, heartbeatOk: ok }),
  pushDebugLog: (entry) => {
    const log: DebugLogEntry = {
      ...entry,
      id: createId(),
      timestamp: new Date().toISOString(),
    };
    const bootLine = `${entry.category}: ${entry.message}`;
    set({
      debugLogs: [log, ...get().debugLogs].slice(0, 200),
      bootLines: [...get().bootLines, bootLine].slice(-40),
    });
  },
  pushBootLine: (line) => set({ bootLines: [...get().bootLines, line].slice(-40) }),
  clearDebugLogs: () => set({ debugLogs: [] }),
}));
