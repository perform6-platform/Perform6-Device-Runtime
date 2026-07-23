import { useDeviceContext } from '../contexts/DeviceContext';
import { useRuntimeContext } from '../contexts/RuntimeContext';
import { useDeviceStore } from '../stores/deviceStore';
import { useRuntimeStore } from '../stores/runtimeStore';

export function useRuntime() {
  const device = useDeviceContext();
  const runtime = useRuntimeContext();
  const store = useRuntimeStore();
  const deviceStore = useDeviceStore();
  const connectionStatus = useRuntimeStore((s) => s.connectionStatus);
  const simulatorSessionActive = useRuntimeStore((s) => s.simulatorSessionActive);

  return { ...device, ...runtime, store, deviceStore, connectionStatus, simulatorSessionActive };
}

export function usePairing() {
  const pairingCode = useDeviceStore((s) => s.pairingCode);
  const pairingId = useDeviceStore((s) => s.pairingId);
  const registrationStatus = useDeviceStore((s) => s.registrationStatus);
  const {
    retryPairing,
    isRegistered,
    isReady,
    needsCredentials,
    beginSimulatorProfile,
    pairNextHdDevice,
    hdPairingHistory,
    fetchCredentials,
    resolveCredentials,
    onCredentialsSaved,
  } = useRuntimeContext();

  return {
    pairingCode,
    pairingId,
    registrationStatus,
    retryPairing,
    isRegistered,
    isReady,
    needsCredentials,
    beginSimulatorProfile,
    pairNextHdDevice,
    hdPairingHistory,
    fetchCredentials,
    resolveCredentials,
    onCredentialsSaved,
  };
}

export function useSync() {
  const syncState = useRuntimeStore((s) => s.syncState);
  const { runSyncNow } = useRuntimeContext();
  return { syncState, runSyncNow };
}

export function useHeartbeat() {
  const lastHeartbeatAt = useRuntimeStore((s) => s.lastHeartbeatAt);
  const heartbeatOk = useRuntimeStore((s) => s.heartbeatOk);
  return { lastHeartbeatAt, heartbeatOk };
}

export function useDebugLogs() {
  const logs = useRuntimeStore((s) => s.debugLogs);
  const clearDebugLogs = useRuntimeStore((s) => s.clearDebugLogs);
  return { logs, clearDebugLogs };
}

export function useDisplayPlayback() {
  const displayVideoSrc = useRuntimeStore((s) => s.displayVideoSrc);
  const setDisplayVideoSrc = useRuntimeStore((s) => s.setDisplayVideoSrc);
  const playbackState = useRuntimeStore((s) => s.playbackState);
  return { displayVideoSrc, setDisplayVideoSrc, playbackState };
}
