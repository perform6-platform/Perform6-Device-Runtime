import { useCallback, useEffect, useState } from 'react';
import { useDeviceContext } from '../../contexts/DeviceContext';
import { usePairing, useRuntime, useSync } from '../../hooks/useRuntime';
import {
  probeApiReachability,
  type NetworkHealth,
} from '../../services/networkHealth';

type OverlayKind = 'none' | 'checking' | 'offline' | 'error';

/**
 * Full-screen status layers for BrightSign (and real runtime errors).
 * Keeps the display from looking like a silent black screen when offline or failing.
 */
export function DeviceStatusOverlay() {
  const { deviceInfo } = useDeviceContext();
  const { connectionStatus } = useRuntime();
  const { registrationStatus, retryPairing } = usePairing();
  const { syncState } = useSync();

  const [health, setHealth] = useState<NetworkHealth>('checking');
  const [detail, setDetail] = useState('Checking network…');
  const [busy, setBusy] = useState(false);

  const runProbe = useCallback(async () => {
    // Avoid flipping UI through a "checking" flash every poll on BrightSign.
    const result = await probeApiReachability();
    setHealth(result.health);
    setDetail(result.detail);
    return result.health;
  }, []);

  useEffect(() => {
    void runProbe();
    const id = window.setInterval(() => {
      void runProbe();
    }, 20_000);

    const onOnline = () => {
      void runProbe();
    };
    const onOffline = () => {
      setHealth('offline');
      setDetail('Internet / network not connected to this device');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [runProbe]);

  const syncError = syncState.error || syncState.credentialsError;
  const phaseError = syncState.runtimePhase === 'error' || registrationStatus === 'error';
  const storeOffline = connectionStatus === 'offline';

  // Do not cover Pairing with a full-screen "checking" layer — that causes a
  // bright flash on BrightSign. Pairing/Home already show boot status.
  let kind: OverlayKind = 'none';
  if (phaseError || syncError) {
    kind = 'error';
  } else if (health === 'offline' || (storeOffline && phaseError)) {
    kind = 'offline';
  }

  if (kind === 'none') return null;

  const title =
    kind === 'offline'
      ? 'Internet is not connected to this device'
      : 'A problem occurred';

  const body =
    kind === 'offline'
      ? detail ||
        'Check the Ethernet / Wi‑Fi cable and router. The player cannot reach the Perform6 server.'
      : syncError ||
        detail ||
        'Pairing or sync failed. See details below and retry.';

  async function handleRetry() {
    setBusy(true);
    try {
      const next = await runProbe();
      if (next === 'online' && (registrationStatus === 'error' || phaseError)) {
        retryPairing();
      }
    } finally {
      setBusy(false);
    }
  }

  const tone =
    kind === 'offline' ? 'border-amber-500/50' : kind === 'error' ? 'border-red-500/50' : 'border-p6-cyan/40';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-8 text-p6-text"
      role="alert"
      aria-live="assertive"
    >
      <div className={`w-full max-w-3xl rounded-2xl border ${tone} bg-p6-bg px-10 py-12 text-center shadow-2xl`}>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-p6-cyan">
          Perform6 device status
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-p6-text-muted">{body}</p>

        <dl className="mx-auto mt-8 grid max-w-lg gap-2 text-left text-sm text-slate-400">
          {deviceInfo && (
            <>
              <div className="flex justify-between gap-4 border-b border-white/10 py-2">
                <dt>Model</dt>
                <dd className="text-slate-200">{deviceInfo.model}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 py-2">
                <dt>Serial</dt>
                <dd className="font-mono text-slate-200">{deviceInfo.serialNumber}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 py-2">
                <dt>MAC</dt>
                <dd className="font-mono text-slate-200">{deviceInfo.macAddress}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4 border-b border-white/10 py-2">
            <dt>Network</dt>
            <dd className="text-slate-200">{health}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt>Phase</dt>
            <dd className="text-slate-200">{syncState.runtimePhase}</dd>
          </div>
        </dl>

        {(kind === 'offline' || kind === 'error') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRetry()}
            className="mt-10 rounded-xl bg-p6-cyan px-10 py-3 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? 'Retrying…' : 'Retry connection'}
          </button>
        )}
      </div>
    </div>
  );
}
