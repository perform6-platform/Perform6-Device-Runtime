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
  applyOtaUpdate,
} from '../services';
import { clearAllSdCachedMarks } from '../services/sdCacheBridge';
import { cancelMediaDownloads, isMediaDownloadInProgress, forceClearMediaDownloadLocks } from '../services/mediaDownloadGate';
import { sendPlaybackTelemetry } from '../services/playbackTelemetryApi';
import { flushDeviceLogs, flushPairingLogs } from '../services/deviceLogsApi';
import { registerDeviceRemoteControlHooks } from '../services/deviceRemoteControl';
import type { RemoteSyncNowOptions } from '../services/deviceRemoteControl';
import { cancelOtaInstall } from '../services/otaApply';
import { processRemoteCommands } from '../services/remoteCommandBridge';
import { startBridgeKeepalive } from '../services/bridgeKeepalive';
import { probeBrightSignAssetPool } from '../services/assetPoolProbe';
import {
  handleDeviceRevoked,
  isDeviceAuthFailure,
  isDeviceDisabledCredentialError,
} from '../services/deviceAuthRevoke';
import { clearLocalDeviceState } from '../services/deviceLocalReset';
import { ApiError } from '../services/api';
import {
  getSdStoragePresence,
  subscribeSdStoragePresence,
} from '../services/sdStoragePresence';
import { getSdStorageForHeartbeat } from '../services/sdStorageInfo';
import {
  loadPlaybackManifestCache,
  savePlaybackManifestCache,
} from '../services/playbackManifestCache';
import {
  consumeSyncOnBoot,
  isMediaSyncPaused,
  reloadPerform6Ops,
  startPerform6OpsPolling,
} from '../services/perform6Ops';
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
  runSyncNow: (forceOrOptions?: boolean | RemoteSyncNowOptions) => Promise<void>;
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
  const pairingId = useDeviceStore((s) => s.pairingId);
  const registrationStatus = useDeviceStore((s) => s.registrationStatus);
  const hasCredentials = useDeviceStore((s) => s.hasCredentials);
  const setPairing = useDeviceStore((s) => s.setPairing);
  const setRegistrationStatus = useDeviceStore((s) => s.setRegistrationStatus);
  const clearDeviceStore = useDeviceStore((s) => s.clear);

  const pushDebugLog = useRuntimeStore((s) => s.pushDebugLog);
  const pushBootLine = useRuntimeStore((s) => s.pushBootLine);
  const setConnectionStatus = useRuntimeStore((s) => s.setConnectionStatus);
  const setSyncState = useRuntimeStore((s) => s.setSyncState);
  const setPlaybackManifest = useRuntimeStore((s) => s.setPlaybackManifest);
  const setHeartbeat = useRuntimeStore((s) => s.setHeartbeat);
  const pendingRoute = useRuntimeStore((s) => s.pendingRoute);
  const setSimulatorSession = useRuntimeStore((s) => s.setSimulatorSession);

  const pairingStarted = useRef(false);
  const registeredNavigated = useRef(false);
  const brightSignBootStarted = useRef(false);
  const activeDeviceInfo = useRef<DeviceInfo | null>(null);

  const credentialFetchStarted = useRef(false);
  /** Separate locks — media asset pool must not block OTA and vice versa. */
  const mediaSyncRunningRef = useRef(false);
  const otaSyncRunningRef = useRef(false);
  const mediaSyncStartedAtRef = useRef(0);
  const otaSyncStartedAtRef = useRef(0);
  /** Media may be multi-GB (up to ~8GB) — do not self-interrupt mid-file. */
  const MEDIA_SYNC_LOCK_MAX_MS = 8 * 60 * 60_000;
  const OTA_SYNC_LOCK_MAX_MS = 60 * 60_000;
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

  const runSyncNow = useCallback(async (forceOrOptions: boolean | RemoteSyncNowOptions = false) => {
    const options: RemoteSyncNowOptions =
      typeof forceOrOptions === 'object' && forceOrOptions != null
        ? forceOrOptions
        : { force: forceOrOptions === true };
    const force = options.force === true;
    // OTA only when Admin explicitly forceOta — never auto on interval / Sync Now.
    const forceOta = options.forceOta === true;
    const skipOta = !forceOta || options.skipOta === true;
    const interrupt = options.interrupt === true;
    const cancelOtaOnInterrupt = options.cancelOta !== false;
    const cancelMediaOnInterrupt = options.cancelMedia !== false;

    const auth = getCredentials();
    const info = activeDeviceInfo.current ?? deviceInfo;
    if (!auth || !info) return;

    await reloadPerform6Ops();
    if (!force && isMediaSyncPaused()) {
      // Admin Install OTA still runs while media sync is paused.
      if (forceOta && !skipOta) {
        pushDebugLog({
          category: 'sync',
          message: 'Media sync paused — running admin Install OTA only',
        });
        setSyncState({ inProgress: true, error: null, runtimePhase: 'syncing' });
        try {
          const applied = await applyOtaUpdate(auth, {
            allowWhenPaused: true,
            clearFailCooldown: true,
          });
          pushDebugLog({
            category: 'sync',
            message: applied.applied
              ? `OTA applied v${applied.version ?? ''}`
              : applied.error
                ? `OTA not applied: ${applied.error}`
                : 'OTA up to date',
          });
        } finally {
          setSyncState({
            lastCheckAt: new Date().toISOString(),
            inProgress: false,
            error: null,
            runtimePhase: 'ready',
          });
        }
        return;
      }

      pushDebugLog({
        category: 'sync',
        message: 'Sync skipped — pauseMediaSync in perform6-ops.json',
      });
      setSyncState({
        lastCheckAt: new Date().toISOString(),
        inProgress: false,
        error: null,
        runtimePhase: 'ready',
      });
      return;
    }

    if (interrupt) {
      if (cancelOtaOnInterrupt) cancelOtaInstall();
      if (cancelMediaOnInterrupt) cancelMediaDownloads();
      forceClearMediaDownloadLocks('remote interrupt');
      mediaSyncRunningRef.current = false;
      otaSyncRunningRef.current = false;
      mediaSyncStartedAtRef.current = 0;
      otaSyncStartedAtRef.current = 0;
    }

    // Absolute max-age: never leave periodic sync blocked for hours.
    if (
      mediaSyncRunningRef.current &&
      mediaSyncStartedAtRef.current > 0 &&
      Date.now() - mediaSyncStartedAtRef.current > MEDIA_SYNC_LOCK_MAX_MS
    ) {
      console.warn('[Perform6] Media sync lock expired — self-interrupt');
      forceClearMediaDownloadLocks('media sync lock max-age');
      cancelMediaDownloads();
      mediaSyncRunningRef.current = false;
      mediaSyncStartedAtRef.current = 0;
    }
    if (
      otaSyncRunningRef.current &&
      otaSyncStartedAtRef.current > 0 &&
      Date.now() - otaSyncStartedAtRef.current > OTA_SYNC_LOCK_MAX_MS
    ) {
      console.warn('[Perform6] OTA sync lock expired — self-interrupt');
      cancelOtaInstall();
      otaSyncRunningRef.current = false;
      otaSyncStartedAtRef.current = 0;
    }

    const mediaBusy =
      mediaSyncRunningRef.current || (!interrupt && isMediaDownloadInProgress());
    const otaBusy = otaSyncRunningRef.current;
    // Admin Install OTA = OTA-only pass (big-company: never mix with media).
    const wantMedia = forceOta ? false : force || !isMediaSyncPaused();
    // OTA never runs on interval / Sync Now — admin Install (forceOta) only.
    const wantOta = forceOta && !skipOta;

    // If media pipeline is busy, still allow an OTA-only pass (and reverse).
    if (mediaBusy && otaBusy && !interrupt) {
      pushDebugLog({
        category: 'sync',
        message: 'Sync skipped — media and OTA both already in progress',
      });
      return;
    }

    if (mediaBusy && !wantOta && !interrupt) {
      pushDebugLog({
        category: 'sync',
        message: 'Sync skipped — media download already in progress',
      });
      return;
    }

    if (otaBusy && !wantMedia && !interrupt) {
      pushDebugLog({
        category: 'sync',
        message: 'Sync skipped — OTA already in progress',
      });
      return;
    }

    const runMedia = wantMedia && (!mediaBusy || interrupt);
    const runOta = wantOta && (!otaBusy || interrupt);

    if (runMedia) {
      mediaSyncRunningRef.current = true;
      mediaSyncStartedAtRef.current = Date.now();
    }
    if (runOta) {
      otaSyncRunningRef.current = true;
      otaSyncStartedAtRef.current = Date.now();
    }
    setSyncState({ inProgress: true, error: null, runtimePhase: 'syncing' });
    pushDebugLog({
      category: 'sync',
      message: 'POST /sync/check started',
      data: { runMedia, runOta },
    });

    try {
      const result = await runSyncEngine(
        {
          ...auth,
          clusterMember: info.clusterMember,
          // XC4055 single player drives all three HDMI LEDs — never filter sync
          // to one SCREEN_*/HDMI port or targets{} empties and LEDs stay blank.
          // XT2145 touch bindings use TOUCH_MAIN (not HDMI) — same unfiltered sync.
          // HD226 still scopes by clusterMember on the auth object.
          displayTarget:
            info.hardwareProfile === 'XC4055' || info.hardwareProfile === 'XT2145'
              ? undefined
              : info.displayTarget,
        },
        info.hardwareProfile,
        {
          onManifest: (earlyManifest) => {
            if (earlyManifest) {
              setPlaybackManifest(earlyManifest);
              savePlaybackManifestCache(earlyManifest);
            }
          },
        },
        {
          forceMediaSync: force,
          skipOta: !runOta || skipOta,
          forceOta: forceOta && runOta,
          skipMedia: !runMedia,
        },
      );

      if (result.success) {
        // Media landed in asset pool (or legacy perform6-cache) inside runSyncEngine.
        if (result.manifest) {
          setPlaybackManifest(result.manifest);
          savePlaybackManifestCache(result.manifest);
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
              sdCacheMedia: result.syncData?.media?.length ?? 0,
              ota: result.ota?.updateAvailable
                ? {
                    version: result.ota.version,
                    reachable: result.ota.reachable,
                    downloadUrl: result.ota.downloadUrl,
                    applied: result.otaApplied,
                    error: result.otaError,
                  }
                : result.otaError
                  ? { error: result.otaError }
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
    } finally {
      if (runMedia) {
        mediaSyncRunningRef.current = false;
        mediaSyncStartedAtRef.current = 0;
      }
      if (runOta) {
        otaSyncRunningRef.current = false;
        otaSyncStartedAtRef.current = 0;
      }
    }
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
        console.info('[Perform6] Skipping pair — credentials already stored');
        pushDebugLog({ category: 'pairing', message: 'Skipping pair — credentials already stored' });
        return;
      }

      activeDeviceInfo.current = info;
      pairingStarted.current = true;
      setRegistrationStatus('pairing');
      setConnectionStatus('connecting');
      setSyncState({ runtimePhase: 'unpaired', error: null });
      pushBootLine(`POST /devices/pair (${info.hardwareProfile})`);
      console.info('[Perform6] POST /devices/pair', {
        serialNumber: info.serialNumber,
        model: info.model,
        hardwareProfile: info.hardwareProfile,
      });
      pushDebugLog({
        category: 'pairing',
        message: `POST /devices/pair as ${info.hardwareProfile}`,
        data: info,
      });

      if (!runtimeConfig.isSimulator) {
        navigate('/pairing', { replace: true });
      }

      try {
        const res = await pairDevice(info);
        if (!res.pairingCode) {
          throw new Error('Pairing API returned empty pairingCode');
        }
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
        setSyncState({ runtimePhase: phase, error: null });

        if (res.apiToken && res.deviceId) {
          useDeviceStore.getState().setCredentials({
            deviceId: res.deviceId,
            apiToken: res.apiToken,
          });
        }

        pushBootLine(`Pairing code ${res.pairingCode}`);
        console.info('[Perform6] Pairing code:', res.pairingCode, res.rawStatus);
        pushDebugLog({
          category: 'pairing',
          message: `Pairing code: ${res.pairingCode} (${res.rawStatus})`,
          data: res,
        });
        setConnectionStatus('online');
        if (!runtimeConfig.isSimulator) {
          navigate('/pairing', { replace: true });
        }
      } catch (e) {
        if (e instanceof PairingConflictError) {
          setRegistrationStatus('registered');
          setSyncState({ runtimePhase: 'waiting_credentials', error: null });
          pushBootLine('Already registered (409) — credentials');
          console.info('[Perform6] Already registered (409) — fetching credentials');
          pushDebugLog({
            category: 'pairing',
            message: 'Device already registered (409) — fetching credentials',
          });
          setConnectionStatus('online');
          return;
        }

        const isNetworkError =
          e instanceof TypeError || (e instanceof ApiError && e.status === 0);
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
          setSyncState({ runtimePhase: 'waiting_claim', error: null });
          console.info('[Perform6] Simulated pairing:', mockCode);
          pushDebugLog({ category: 'pairing', message: `Simulated pairing: ${mockCode}` });
          setConnectionStatus('online');
          return;
        }

        pairingStarted.current = false;
        setRegistrationStatus('error');
        const errMsg =
          e instanceof ApiError
            ? `Pairing failed: ${e.message}`
            : e instanceof TypeError
              ? 'Internet / network not connected to this device (or HTTPS/TLS to API failed)'
              : e instanceof Error
                ? e.message
                : 'Pairing failed';
        console.error('[Perform6] Pairing API failed', errMsg, e);
        setSyncState({ runtimePhase: 'error', error: errMsg });
        setConnectionStatus('offline');
        pushBootLine(errMsg);
        pushDebugLog({
          category: 'pairing',
          message: errMsg,
        });
      }
    },
    [
      navigate,
      pushBootLine,
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
      clearAllSdCachedMarks();
      setPlaybackManifest(null);
      setSimulatorSession({ active: true, pendingRoute: route });

      const info = await refreshDeviceInfo({
        ...profileOverrides,
        hardwareProfile,
        deploymentType:
          profileOverrides.deploymentType ?? profileDefaultDeployment(hardwareProfile),
        displayTarget: undefined,
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

    const errText = result.error ?? 'Credentials not ready';
    if (isDeviceDisabledCredentialError(errText)) {
      console.warn('[Perform6] Credentials blocked — device disabled; re-pairing', errText);
      pushDebugLog({
        category: 'pairing',
        message: `Disabled device credentials blocked — re-pair: ${errText}`,
      });
      clearLocalDeviceState();
      credentialFetchStarted.current = false;
      pairingStarted.current = false;
      setRegistrationStatus('idle');
      setSyncState({
        credentialsFetching: false,
        credentialsError: 'Device disabled — starting fresh pairing…',
        runtimePhase: 'waiting_claim',
      });
      void executePairing(info);
      return;
    }

    setSyncState({
      credentialsFetching: false,
      credentialsError: result.notReady
        ? 'Waiting for admin registration to complete…'
        : errText,
      runtimePhase: 'waiting_credentials',
    });
    pushDebugLog({
      category: 'pairing',
      message: errText,
    });
  }, [deviceInfo, executePairing, pushDebugLog, runSyncNow, setRegistrationStatus, setSyncState]);

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

  // BrightSign / file:// production: collect hardware identity, then pair immediately.
  // Simulator uses beginSimulatorProfile() instead — do not auto-boot there.
  useEffect(() => {
    if (runtimeConfig.isSimulator) return;
    if (brightSignBootStarted.current) return;
    brightSignBootStarted.current = true;

    void (async () => {
      try {
        // Clear stuck persist (e.g. registrationStatus=pairing with no code) so boot can re-pair.
        const persisted = useDeviceStore.getState();
        if (!isDeviceReady()) {
          const stuckNoCode =
            !persisted.pairingCode &&
            (persisted.registrationStatus === 'pairing' ||
              persisted.registrationStatus === 'error' ||
              persisted.registrationStatus === 'waiting_for_registration' ||
              persisted.registrationStatus === 'paired' ||
              persisted.registrationStatus === 'registered');
          if (stuckNoCode) {
            console.info(
              '[Perform6] Resetting stuck pairing state',
              persisted.registrationStatus,
            );
            clearDeviceStore();
            pairingStarted.current = false;
          }
        }

        pushBootLine(`Collecting device info (${runtimeConfig.hardwareProfile})`);
        pushDebugLog({
          category: 'device',
          message: `BrightSign boot — collecting device info (${runtimeConfig.hardwareProfile})`,
        });
        console.info(
          '[Perform6] BrightSign boot — collecting device info',
          runtimeConfig.hardwareProfile,
        );

        const info = await refreshDeviceInfo({
          hardwareProfile: runtimeConfig.hardwareProfile,
          deploymentType: profileDefaultDeployment(runtimeConfig.hardwareProfile),
          displayTarget: undefined,
          clusterMember:
            runtimeConfig.hardwareProfile === 'HD226' ? runtimeConfig.clusterMember : undefined,
        });

        console.info('[Perform6] BrightSign boot — device ready', {
          model: info.model,
          serialNumber: info.serialNumber,
          hardwareProfile: info.hardwareProfile,
        });
        pushBootLine(`Device ready ${info.model} / ${info.serialNumber}`);
        pushDebugLog({
          category: 'device',
          message: `Device ready ${info.model} / ${info.serialNumber}`,
        });

        navigate('/pairing', { replace: true });

        const afterReset = useDeviceStore.getState();
        if (isDeviceReady()) {
          console.info('[Perform6] Credentials already stored — skipping pair');
          return;
        }

        if (afterReset.pairingCode) {
          console.info('[Perform6] Restored pairing code:', afterReset.pairingCode);
          pushBootLine(`Restored pairing code ${afterReset.pairingCode}`);
          pushDebugLog({
            category: 'pairing',
            message: `Restored pairing code: ${afterReset.pairingCode}`,
          });
          return;
        }

        pushBootLine('Starting pairing request…');
        console.info('[Perform6] Starting pairing request…');
        pushDebugLog({
          category: 'pairing',
          message: 'Starting pairing request…',
        });
        await executePairing(info);
      } catch (e) {
        const errMsg =
          e instanceof Error ? e.message : 'Failed to start device runtime on BrightSign';
        console.error('[Perform6] BrightSign boot failed', e);
        setRegistrationStatus('error');
        setSyncState({ runtimePhase: 'error', error: errMsg });
        setConnectionStatus('offline');
        pushBootLine(errMsg);
        pushDebugLog({ category: 'device', message: errMsg });
      }
    })();
  }, [
    clearDeviceStore,
    executePairing,
    navigate,
    pushBootLine,
    pushDebugLog,
    refreshDeviceInfo,
    setConnectionStatus,
    setRegistrationStatus,
    setSyncState,
  ]);

  // Backup: if deviceInfo appears without boot path completing pair (rare), still pair.
  useEffect(() => {
    if (runtimeConfig.isSimulator) return;
    if (!deviceInfo || pairingStarted.current || isDeviceReady()) return;
    if (useDeviceStore.getState().pairingCode) return;
    if (registrationStatus !== 'idle' && registrationStatus !== 'error') return;
    void executePairing(deviceInfo);
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

  // Pre-register: stream logs while ONLINE / waiting (no device token yet).
  useEffect(() => {
    if (runtimeConfig.isSimulator) return;
    if (isDeviceReady() || hasCredentials) return;
    if (!pairingId) return;
    if (
      registrationStatus !== 'waiting_for_registration' &&
      registrationStatus !== 'paired' &&
      registrationStatus !== 'registered'
    ) {
      return;
    }

    const tick = () => {
      if (isDeviceReady()) return;
      const info = activeDeviceInfo.current ?? deviceInfo;
      const serial = info?.serialNumber?.trim();
      const pid = useDeviceStore.getState().pairingId;
      if (!serial || !pid) return;
      void flushPairingLogs(pid, serial).catch(() => {
        /* best-effort until API/migration is live */
      });
    };

    tick();
    const id = window.setInterval(tick, Math.max(runtimeConfig.pairingPollMs * 2, 10_000));
    return () => window.clearInterval(id);
  }, [deviceInfo, hasCredentials, pairingId, registrationStatus]);

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
    if (runtimeConfig.isSimulator) return;
    return startPerform6OpsPolling(60_000);
  }, []);

  useEffect(() => {
    if (!isDeviceReady() || !deviceInfo || runtimeConfig.isSimulator) return;

    void (async () => {
      const shouldSync = await consumeSyncOnBoot();
      if (shouldSync) {
        pushDebugLog({
          category: 'sync',
          message: 'syncOnBoot requested via perform6-ops.json',
        });
        await runSyncNow(true);
      }
    })();
  }, [deviceInfo, hasCredentials, pushDebugLog, runSyncNow]);

  useEffect(() => {
    if (!isDeviceReady() || !deviceInfo) return;
    const cached = loadPlaybackManifestCache();
    if (cached) {
      setPlaybackManifest(cached);
      pushDebugLog({
        category: 'playback',
        message: 'Restored offline playback manifest from cache',
        data: { screens: cached.screens.length },
      });
    }
  }, [deviceInfo, hasCredentials, pushDebugLog, setPlaybackManifest]);

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
    registerDeviceRemoteControlHooks({ runSyncNow });
  }, [runSyncNow]);

  useEffect(() => {
    if (!isDeviceReady()) return;
    startBridgeKeepalive();
  }, [deviceInfo, hasCredentials]);

  useEffect(() => {
    if (!isDeviceReady()) return;

    let bootHeartbeatPending = true;
    const profile = deviceInfo?.hardwareProfile ?? runtimeConfig.hardwareProfile;
    const version = runtimeConfig.runtimeVersion;
    console.info(
      `[Perform6] Autorun UI ready · profile=${profile} · v${version}`,
    );

    const tick = () => {
      const auth = getCredentials();
      if (!auth) return;
      const isBoot = bootHeartbeatPending;
      const assetPool = probeBrightSignAssetPool();
      const sd = getSdStoragePresence();
      void getSdStorageForHeartbeat().then((storage) => {
        const payload = {
          firmwareVersion: deviceInfo?.firmwareVersion,
          ...storage,
          metadata: {
            ...(isBoot
              ? {
                  bootEvent: true,
                  bootAt: new Date().toISOString(),
                  hardwareProfile: profile,
                  runtimeVersion: version,
                  assetPool,
                }
              : {}),
            ...(deviceInfo?.ipAddress
              ? { ipAddress: deviceInfo.ipAddress, lanIpAddress: deviceInfo.ipAddress }
              : {}),
            ...(sd.sdPresent != null
              ? {
                  sdPresent: sd.sdPresent,
                  sdEvent: sd.sdEvent,
                  sdEventAt: sd.sdEventAt,
                  sdMount: sd.sdMount,
                }
              : {}),
          },
        };
        void sendDeviceHeartbeat(auth, payload)
          .then((result) => {
            setHeartbeat({ at: new Date().toISOString(), ok: true });
            pushDebugLog({ category: 'heartbeat', message: 'POST /devices/me/heartbeat OK' });
            if (isBoot) {
              bootHeartbeatPending = false;
              void flushDeviceLogs(auth).catch(() => {
                /* best-effort boot log upload */
              });
            }
            if (result.remoteCommands?.length) {
              void processRemoteCommands(result.remoteCommands);
            }
          })
          .catch((error) => {
            setHeartbeat({ at: new Date().toISOString(), ok: false });
            if (isDeviceAuthFailure(error)) {
              handleDeviceRevoked(
                error instanceof ApiError ? error.message : 'heartbeat auth failed',
              );
            }
          });
      });
    };

    tick();
    const unsubSd = subscribeSdStoragePresence(() => {
      tick();
    });
    const id = window.setInterval(tick, runtimeConfig.heartbeatIntervalMs);
    return () => {
      window.clearInterval(id);
      unsubSd();
    };
  }, [deviceInfo, hasCredentials, pushDebugLog, setHeartbeat]);

  // Lightweight playhead flush for admin live preview (~8s; avoids heartbeat_logs bloat).
  useEffect(() => {
    if (!isDeviceReady()) return;

    const tick = () => {
      const auth = getCredentials();
      if (!auth) return;
      void sendPlaybackTelemetry(auth).catch(() => {
        /* best-effort — monitoring only */
      });
    };

    tick();
    const id = window.setInterval(tick, 8_000);
    return () => window.clearInterval(id);
  }, [deviceInfo, hasCredentials]);

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
