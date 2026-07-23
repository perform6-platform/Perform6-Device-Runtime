import { create } from 'zustand';
import type {
  ConnectionStatus,
  DebugLogEntry,
  DeviceInfo,
  PlaybackManifest,
  PlaybackState,
  SyncState,
} from '../shared/types';

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
  displayPaused: boolean;
  displayMuted: boolean;
  displayVolume: number;
  displayRestartNonce: number;
  displayVideoLoop: boolean;
  simulatorSessionActive: boolean;
  pendingRoute: string | null;
  setDeviceInfo: (info: DeviceInfo) => void;
  setSimulatorSession: (payload: { active: boolean; pendingRoute?: string | null }) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setSyncState: (partial: Partial<SyncState>) => void;
  setPlaybackManifest: (manifest: PlaybackManifest | null) => void;
  setDisplayVideoSrc: (src: string | null) => void;
  resetDisplayControls: () => void;
  toggleDisplayPaused: () => void;
  toggleDisplayMuted: () => void;
  setDisplayVolume: (volume: number) => void;
  setDisplayVideoLoop: (loop: boolean) => void;
  setDisplayPaused: (paused: boolean) => void;
  restartDisplayVideo: () => void;
  setPlaybackPlaying: (isPlaying: boolean) => void;
  setHeartbeat: (payload: { at: string; ok: boolean }) => void;
  pushDebugLog: (entry: Omit<DebugLogEntry, 'id' | 'timestamp'>) => void;
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
  displayPaused: false,
  displayMuted: true,
  displayVolume: 1,
  displayRestartNonce: 0,
  displayVideoLoop: true,
  simulatorSessionActive: false,
  pendingRoute: null,
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
  setDisplayVideoSrc: (displayVideoSrc) => set({ displayVideoSrc }),
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
  restartDisplayVideo: () =>
    set({ displayRestartNonce: get().displayRestartNonce + 1, displayPaused: false }),
  setPlaybackPlaying: (isPlaying) =>
    set({ playbackState: { ...get().playbackState, isPlaying } }),
  setHeartbeat: ({ at, ok }) => set({ lastHeartbeatAt: at, heartbeatOk: ok }),
  pushDebugLog: (entry) => {
    const log: DebugLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    set({ debugLogs: [log, ...get().debugLogs].slice(0, 200) });
  },
  clearDebugLogs: () => set({ debugLogs: [] }),
}));
