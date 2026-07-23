import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { runtimeConfig, profileDefaultDeployment } from '../config/runtime';
import {
  pairDevice,
  pollPairingStatus,
  PairingConflictError,
  resolvePairingIdentity,
  createMockManifest,
  getPostRegistrationRoute,
  runSyncEngine,
  sendDeviceHeartbeat,
  getCredentials,
  fetchAndStoreCredentials,
  clearCachedMediaVersionIds,
} from '../services';
import { ApiError } from '../services/api';
import type { ClusterMember, DeviceInfo, DeviceRegistrationStatus } from '../shared/types';
import type { MockDeviceOptions } from '../shared/mockDevice';
import { isDeviceReady, useDeviceStore } from '../stores/deviceStore';
import { useRuntimeStore } from '../stores/runtimeStore';
import { useDeviceContext } from './DeviceContext';
import {
  clearHdPairingSession,
  hdClusterMemberRoute,
  loadHdPairingSession,
  resolveNextHdClusterMember,
  upsertHdPairingSessionEntry,
  type HdPairingSessionEntry,
} from '../simulator/hdClusterPairing';

interface BeginSimulatorProfileOptions extends MockDeviceOptions {
  route: string;
  /** When true, wipe HD multi-pair session history (fresh HD226 launch). */
  resetHdPairingSession?: boolean;
}

interface RuntimeContextValue {
  registrationStatus: DeviceRegistrationStatus;
  pairingCode: string | null;
  isRegistered: boolean;
  isReady: boolean;
  needsCredentials: boolean;
  retryPairing: () => void;
  runSyncNow: () => Promise<void>;
  beginSimulatorProfile: (options: BeginSimulatorProfileOptions) => Promise<void>;
  /** Simulator-only: clear current HD unit and POST /devices/pair as the next DEVICE_*. */
  pairNextHdDevice: (member?: ClusterMember) => Promise<void>;
  hdPairingHistory: HdPairingSessionEntry[];
  refreshHdPairingHistory: () => void;
  fetchCredentials: () => Promise<void>;
  resolveCredentials: (deviceId: string) => Promise<void>;
  onCredentialsSaved: () => Promise<void>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { deviceInfo, refreshDeviceInfo } = useDeviceContext();

  const pairingCode = useDeviceStore((s) => s.pairingCode);
  const registrationStatus = useDeviceStore((s) => s.registrationStatus);
  const hasCredentials = useDeviceStore((s) => s.hasCredentials);
  const setPairing = useDeviceStore((s) => s.setPairing);
  const setRegistrationStatus = useDeviceStore((s) => s.setRegistrationStatus);
  const clearDeviceStore = useDeviceStore((s) => s.clear);

  const pushDebugLog = useRuntimeStore((s) => s.pushDebugLog);
  const setConnectionStatus = useRuntimeStore((s) => s.setConnectionStatus);
  const setSyncState = useRuntimeStore((s) => s.setSyncState);
  const setPlaybackManifest = useRuntimeStore((s) => s.setPlaybackManifest);
  const setHeartbeat = useRuntimeStore((s) => s.setHeartbeat);
  const pendingRoute = useRuntimeStore((s) => s.pendingRoute);
  const setSimulatorSession = useRuntimeStore((s) => s.setSimulatorSession);

  const pairingStarted = useRef(false);
  const registeredNavigated = useRef(false);
  const activeDeviceInfo = useRef<DeviceInfo | null>(null);

  const credentialFetchStarted = useRef(false);
  const [hdPairingHistory, setHdPairingHistory] = useState<HdPairingSessionEntry[]>(() =>
    loadHdPairingSession().entries,
  );

  const refreshHdPairingHistory = useCallback(() => {
    setHdPairingHistory(loadHdPairingSession().entries);
  }, []);

  const recordHdPairing = useCallback(
    (
      info: DeviceInfo,
      pairing: {
        pairingId: string;
        pairingCode: string;
        registrationStatus: DeviceRegistrationStatus;
      },
    ) => {
      if (info.hardwareProfile !== 'HD226' || !info.clusterMember || !pairing.pairingCode) {
        return;
      }
      const session = upsertHdPairingSessionEntry({
        clusterMember: info.clusterMember,
        pairingId: pairing.pairingId,
        pairingCode: pairing.pairingCode,
        serialNumber: info.serialNumber,
        registrationStatus: pairing.registrationStatus,
      });
      setHdPairingHistory(session.entries);
    },
    [],
  );

  const isReady = isDeviceReady();
  const isRegistered = registrationStatus === 'registered';
  const needsCredentials = registrationStatus === 'registered' && !hasCredentials;

  const applyMockManifest = useCallback(async () => {
    const info = activeDeviceInfo.current ?? deviceInfo;
    if (!info) return;
    const manifest = createMockManifest(info.hardwareProfile);
    setPlaybackManifest(manifest);
    setSyncState({ runtimePhase: 'ready', lastSyncAt: new Date().toISOString() });
    pushDebugLog({ category: 'playback', message: 'Mock manifest loaded', data: manifest });
  }, [deviceInfo, pushDebugLog, setPlaybackManifest, setSyncState]);

  const runSyncNow = useCallback(async () => {
    const auth = getCredentials();
    const info = activeDeviceInfo.current ?? deviceInfo;
    if (!auth || !info) return;

    setSyncState({ inProgress: true, error: null, runtimePhase: 'syncing' });
    pushDebugLog({ category: 'sync', message: 'POST /sync/check started' });

    const result = await runSyncEngine(
      {
        ...auth,
        clusterMember: info.clusterMember,
        // XC4055 3-pane simulator must not filter to a single HDMI port —
        // otherwise targets{} empties and panes stay blank while media still downloads.
        // Simulator: never filter XT/XC bindings — XT has TOUCH_MAIN (not HDMI),
        // XC needs all three panes. HD still scopes by clusterMember.
        displayTarget:
          runtimeConfig.isSimulator &&
          (info.hardwareProfile === 'XC4055' ||
            info.hardwareProfile === 'XT2145')
            ? undefined
            : info.displayTarget,
      },
      info.hardwareProfile,
    );

    if (result.success) {
      if (result.manifest) {
        setPlaybackManifest(result.manifest);
        setSyncState({
          lastCheckAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
          syncJobId: result.syncData?.syncJobId ?? null,
          inProgress: false,
          error: null,
          runtimePhase: 'ready',
        });
        setConnectionStatus('online');
        pushDebugLog({
          category: 'sync',
          message: 'Sync completed',
          data: {
            syncJobId: result.syncData?.syncJobId,
            screens: result.manifest.screens.length,
            completeReportFailures: result.completeReportFailures ?? 0,
            ota: result.ota?.updateAvailable
              ? {
                  version: result.ota.version,
                  reachable: result.ota.reachable,
                  downloadUrl: result.ota.downloadUrl,
                }
              : undefined,
          },
        });
      } else {
        setSyncState({
          lastCheckAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
          syncJobId: result.syncData?.syncJobId ?? null,
          inProgress: false,
          error: 'Sync returned no playback content',
          runtimePhase: 'ready',
        });
        setConnectionStatus('online');
        pushDebugLog({
          category: 'sync',
          message: 'Sync OK but no playback manifest content',
          data: { syncJobId: result.syncData?.syncJobId },
        });
      }
      return;
    }

    if (runtimeConfig.isSimulator) {
      await applyMockManifest();
      setSyncState({ inProgress: false, error: null, runtimePhase: 'ready' });
      setConnectionStatus('online');
      pushDebugLog({
        category: 'sync',
        message: `Sync failed — using mock manifest: ${result.error}`,
      });
      return;
    }

    setSyncState({
      inProgress: false,
      error: result.error ?? 'Sync failed',
      runtimePhase: 'error',
    });
    setConnectionStatus('offline');
    pushDebugLog({ category: 'sync', message: result.error ?? 'Sync failed' });
  }, [
    applyMockManifest,
    deviceInfo,
    pushDebugLog,
    setConnectionStatus,
    setPlaybackManifest,
    setSyncState,
  ]);

  const executePairing = useCallback(
    async (info: DeviceInfo) => {
      if (isDeviceReady()) {
        pushDebugLog({ category: 'pairing', message: 'Skipping pair — credentials already stored' });
        return;
      }

      activeDeviceInfo.current = info;
      pairingStarted.current = true;
      setRegistrationStatus('pairing');
      setConnectionStatus('connecting');
      setSyncState({ runtimePhase: 'unpaired' });
      pushDebugLog({
        category: 'pairing',
        message: `POST /devices/pair as ${info.hardwareProfile}`,
        data: info,
      });

      try {
        const res = await pairDevice(info);
        setPairing({
          pairingId: res.pairingId,
          pairingCode: res.pairingCode,
          registrationStatus: res.registrationStatus,
        });
        recordHdPairing(info, {
          pairingId: res.pairingId,
          pairingCode: res.pairingCode,
          registrationStatus: res.registrationStatus,
        });

        const phase =
          res.registrationStatus === 'registered'
            ? 'waiting_credentials'
            : res.registrationStatus === 'paired'
              ? 'waiting_register'
              : 'waiting_claim';
        setSyncState({ runtimePhase: phase });

        if (res.apiToken && res.deviceId) {
          useDeviceStore.getState().setCredentials({
            deviceId: res.deviceId,
            apiToken: res.apiToken,
          });
        }

        pushDebugLog({
          category: 'pairing',
          message: `Pairing code: ${res.pairingCode} (${res.rawStatus})`,
          data: res,
        });
        setConnectionStatus('online');
      } catch (e) {
        if (e instanceof PairingConflictError) {
          setRegistrationStatus('registered');
          setSyncState({ runtimePhase: 'waiting_credentials' });
          pushDebugLog({
            category: 'pairing',
            message: 'Device already registered (409) — fetching credentials',
          });
          setConnectionStatus('online');
          return;
        }

        const isNetworkError = e instanceof TypeError;
        if (runtimeConfig.isSimulator && isNetworkError) {
          const mockCode = Math.floor(100000 + Math.random() * 900000).toString();
          setPairing({
            pairingId: `sim-${info.serialNumber}`,
            pairingCode: mockCode,
            registrationStatus: 'waiting_for_registration',
          });
          recordHdPairing(info, {
            pairingId: `sim-${info.serialNumber}`,
            pairingCode: mockCode,
            registrationStatus: 'waiting_for_registration',
          });
          setSyncState({ runtimePhase: 'waiting_claim' });
          pushDebugLog({ category: 'pairing', message: `Simulated pairing: ${mockCode}` });
          setConnectionStatus('online');
          return;
        }

        pairingStarted.current = false;
        setRegistrationStatus('error');
        setSyncState({ runtimePhase: 'error' });
        setConnectionStatus('offline');
        pushDebugLog({
          category: 'pairing',
          message: e instanceof ApiError ? `Pairing failed: ${e.message}` : 'Pairing failed',
        });
      }
    },
    [
      pushDebugLog,
      recordHdPairing,
      setConnectionStatus,
      setPairing,
      setRegistrationStatus,
      setSyncState,
    ],
  );

  const beginSimulatorProfile = useCallback(
    async (options: BeginSimulatorProfileOptions) => {
      const { route, resetHdPairingSession = false, ...profileOverrides } = options;
      const hardwareProfile = profileOverrides.hardwareProfile ?? runtimeConfig.hardwareProfile;

      if (resetHdPairingSession) {
        clearHdPairingSession();
        setHdPairingHistory([]);
      }

      pairingStarted.current = false;
      registeredNavigated.current = false;
      // Full local wipe so re-pair after admin disable never reuses stale code/token/cache.
      clearDeviceStore();
      clearCachedMediaVersionIds();
      setPlaybackManifest(null);
      setSimulatorSession({ active: true, pendingRoute: route });

      const info = await refreshDeviceInfo({
        ...profileOverrides,
        hardwareProfile,
        deploymentType:
          profileOverrides.deploymentType ?? profileDefaultDeployment(hardwareProfile),
        displayTarget:
          hardwareProfile === 'XC4055'
            ? (profileOverrides.displayTarget ?? runtimeConfig.displayTarget)
            : undefined,
        clusterMember:
          hardwareProfile === 'HD226'
            ? (profileOverrides.clusterMember ?? runtimeConfig.clusterMember)
            : undefined,
      });

      await executePairing(info);
    },
    [
      clearDeviceStore,
      executePairing,
      refreshDeviceInfo,
      setPlaybackManifest,
      setSimulatorSession,
    ],
  );

  const pairNextHdDevice = useCallback(
    async (member?: ClusterMember) => {
      if (!runtimeConfig.isSimulator) {
        throw new Error('pairNextHdDevice is only available in the simulator');
      }

      const info = activeDeviceInfo.current ?? deviceInfo;
      const store = useDeviceStore.getState();

      if (info?.hardwareProfile === 'HD226' && info.clusterMember && store.pairingCode && store.pairingId) {
        recordHdPairing(info, {
          pairingId: store.pairingId,
          pairingCode: store.pairingCode,
          registrationStatus: store.registrationStatus,
        });
      }

      const nextMember =
        member ??
        resolveNextHdClusterMember(
          info?.hardwareProfile === 'HD226' ? info.clusterMember : null,
        );

      if (!nextMember) {
        throw new Error('All HD226 cluster members (DEVICE_A–J) already have pairing codes in this session');
      }

      pushDebugLog({
        category: 'pairing',
        message: `Pairing next HD cluster member: ${nextMember}`,
      });

      await beginSimulatorProfile({
        hardwareProfile: 'HD226',
        deploymentType: profileDefaultDeployment('HD226'),
        clusterMember: nextMember,
        route: hdClusterMemberRoute(nextMember),
        resetHdPairingSession: false,
      });
    },
    [beginSimulatorProfile, deviceInfo, pushDebugLog, recordHdPairing],
  );

  const fetchCredentials = useCallback(async () => {
    const info = activeDeviceInfo.current ?? deviceInfo;
    const state = useDeviceStore.getState();
    if (!info || isDeviceReady()) return;

    setSyncState({
      credentialsFetching: true,
      credentialsError: null,
      runtimePhase: 'waiting_credentials',
    });
    pushDebugLog({
      category: 'pairing',
      message: 'POST /devices/pairings/credentials',
      data: { pairingId: state.pairingId, serialNumber: info.serialNumber },
    });

    const result = await fetchAndStoreCredentials({
      serialNumber: info.serialNumber,
      pairingId: state.pairingId,
      deviceId: state.deviceId,
      deviceInfo: info,
    });

    if (result.success) {
      setSyncState({ credentialsFetching: false, credentialsError: null, runtimePhase: 'syncing' });
      pushDebugLog({
        category: 'pairing',
        message: 'Credentials acquired',
        data: { deviceId: result.credentials?.deviceId },
      });
      registeredNavigated.current = false;
      await runSyncNow();
      return;
    }

    setSyncState({
      credentialsFetching: false,
      credentialsError: result.notReady
        ? 'Waiting for admin registration to complete…'
        : (result.error ?? 'Credential fetch failed'),
      runtimePhase: 'waiting_credentials',
    });
    pushDebugLog({
      category: 'pairing',
      message: result.error ?? 'Credentials not ready',
    });
  }, [deviceInfo, pushDebugLog, runSyncNow, setSyncState]);

  const resolveCredentials = useCallback(
    async (deviceId: string) => {
      const info = activeDeviceInfo.current ?? deviceInfo;
      if (!info || isDeviceReady()) return;

      setSyncState({ credentialsFetching: true, credentialsError: null });
      pushDebugLog({
        category: 'pairing',
        message: 'POST /devices/credentials/resolve',
        data: { deviceId, serialNumber: info.serialNumber },
      });

      const result = await fetchAndStoreCredentials({
        serialNumber: info.serialNumber,
        deviceId,
        deviceInfo: info,
      });

      if (result.success) {
        setSyncState({ credentialsFetching: false, credentialsError: null, runtimePhase: 'syncing' });
        registeredNavigated.current = false;
        await runSyncNow();
        return;
      }

      setSyncState({
        credentialsFetching: false,
        credentialsError: result.error ?? 'Resolve failed',
        runtimePhase: 'waiting_credentials',
      });
      throw new Error(result.error ?? 'Resolve failed');
    },
    [deviceInfo, pushDebugLog, runSyncNow, setSyncState],
  );

  const onCredentialsSaved = useCallback(async () => {
    registeredNavigated.current = false;
    setSyncState({ runtimePhase: 'syncing' });
    await runSyncNow();
  }, [runSyncNow, setSyncState]);

  const retryPairing = useCallback(() => {
    const info = activeDeviceInfo.current ?? deviceInfo;
    if (!info) return;
    pairingStarted.current = false;
    void executePairing(info);
  }, [deviceInfo, executePairing]);

  useEffect(() => {
    if (runtimeConfig.isSimulator) return;
    if (deviceInfo && registrationStatus === 'idle' && !pairingStarted.current && !isDeviceReady()) {
      void executePairing(deviceInfo);
    }
  }, [deviceInfo, registrationStatus, executePairing]);

  useEffect(() => {
    if (isDeviceReady() || hasCredentials) return;
    if (
      registrationStatus !== 'waiting_for_registration' &&
      registrationStatus !== 'paired' &&
      registrationStatus !== 'registered'
    ) {
      return;
    }

    const poll = () => {
      if (isDeviceReady()) return;

      const info = activeDeviceInfo.current ?? deviceInfo;
      if (!info) return;

      void pollPairingStatus(info)
        .then((res) => {
          if (isDeviceReady()) return;

          setPairing({
            pairingId: res.pairingId,
            pairingCode: res.pairingCode,
            registrationStatus: res.registrationStatus,
          });
          recordHdPairing(info, {
            pairingId: res.pairingId,
            pairingCode: res.pairingCode,
            registrationStatus: res.registrationStatus,
          });

          if (res.registrationStatus === 'registered') {
            if (!isDeviceReady()) {
              setSyncState({ runtimePhase: 'waiting_credentials' });
            }
            pushDebugLog({
              category: 'pairing',
              message: `REGISTERED — fetching credentials (pairingId: ${res.pairingId})`,
            });
          } else if (res.registrationStatus === 'paired') {
            setSyncState({ runtimePhase: 'waiting_register' });
            pushDebugLog({ category: 'pairing', message: `ADMIN_CLAIMED — complete deployment` });
          }
        })
        .catch(async (e) => {
          if (isDeviceReady()) return;
          if (e instanceof PairingConflictError) {
            const info = activeDeviceInfo.current ?? deviceInfo;
            if (info) {
              try {
                const resolved = await resolvePairingIdentity(info);
                setPairing({
                  pairingId: resolved.pairingId,
                  pairingCode: resolved.pairingCode,
                  registrationStatus: resolved.registrationStatus,
                });
                return;
              } catch {
                // fall through
              }
            }
            setRegistrationStatus('registered');
            if (!isDeviceReady()) {
              setSyncState({ runtimePhase: 'waiting_credentials' });
            }
          }
        });
    };

    poll();
    const id = window.setInterval(poll, runtimeConfig.pairingPollMs);
    return () => window.clearInterval(id);
  }, [
    deviceInfo,
    hasCredentials,
    pushDebugLog,
    recordHdPairing,
    registrationStatus,
    setPairing,
    setRegistrationStatus,
    setSyncState,
  ]);

  // Auto-fetch credentials when admin registration completes
  useEffect(() => {
    if (hasCredentials || registrationStatus !== 'registered') {
      credentialFetchStarted.current = false;
      return;
    }

    if (!credentialFetchStarted.current) {
      credentialFetchStarted.current = true;
      void fetchCredentials();
    }

    const id = window.setInterval(() => void fetchCredentials(), runtimeConfig.pairingPollMs);
    return () => window.clearInterval(id);
  }, [fetchCredentials, hasCredentials, registrationStatus]);

  useEffect(() => {
    if (!isDeviceReady() || !deviceInfo) return;
    void runSyncNow();
    const id = window.setInterval(() => void runSyncNow(), runtimeConfig.syncIntervalMs);
    return () => window.clearInterval(id);
  }, [deviceInfo, hasCredentials, runSyncNow]);

  useEffect(() => {
    if (!isDeviceReady() || !deviceInfo || registeredNavigated.current) return;
    registeredNavigated.current = true;
    const route = pendingRoute ?? getPostRegistrationRoute(deviceInfo.hardwareProfile);
    navigate(route, { replace: true });
  }, [deviceInfo, hasCredentials, navigate, pendingRoute]);

  useEffect(() => {
    if (!isDeviceReady()) return;

    const tick = () => {
      const auth = getCredentials();
      if (!auth) return;
      void sendDeviceHeartbeat(auth, { firmwareVersion: deviceInfo?.firmwareVersion })
        .then(() => {
          setHeartbeat({ at: new Date().toISOString(), ok: true });
          pushDebugLog({ category: 'heartbeat', message: 'POST /devices/me/heartbeat OK' });
        })
        .catch(() => {
          setHeartbeat({ at: new Date().toISOString(), ok: false });
        });
    };

    tick();
    const id = window.setInterval(tick, runtimeConfig.heartbeatIntervalMs);
    return () => window.clearInterval(id);
  }, [deviceInfo, hasCredentials, pushDebugLog, setHeartbeat]);

  const value = useMemo(
    () => ({
      registrationStatus,
      pairingCode,
      isRegistered,
      isReady,
      needsCredentials,
      retryPairing,
      runSyncNow,
      beginSimulatorProfile,
      pairNextHdDevice,
      hdPairingHistory,
      refreshHdPairingHistory,
      fetchCredentials,
      resolveCredentials,
      onCredentialsSaved,
    }),
    [
      registrationStatus,
      pairingCode,
      isRegistered,
      isReady,
      needsCredentials,
      retryPairing,
      runSyncNow,
      beginSimulatorProfile,
      pairNextHdDevice,
      hdPairingHistory,
      refreshHdPairingHistory,
      fetchCredentials,
      resolveCredentials,
      onCredentialsSaved,
    ],
  );

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntimeContext(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error('useRuntimeContext must be used within RuntimeProvider');
  return ctx;
}
