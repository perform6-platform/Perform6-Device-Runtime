import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDeviceContext } from '../contexts/DeviceContext';
import { useHeartbeat, usePairing, useRuntime, useSync } from '../hooks/useRuntime';
import { PairingCodeDisplay, CredentialInjectionForm } from '../components/pairing';
import { runtimeConfig } from '../config/runtime';
import { getPostRegistrationRoute } from '../services/runtime';
import { PrimaryOutputOnly } from '../layout/PrimaryOutputOnly';
import {
  clusterMemberShortLabel,
  resolveNextHdClusterMember,
} from '../simulator/hdClusterPairing';

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        ok ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/50 text-amber-300'
      }`}
    >
      {label}
    </span>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'waiting_for_registration':
      return 'Waiting for Admin Claim';
    case 'paired':
      return 'Admin Claimed — Waiting for Deployment';
    case 'registered':
      return 'Registered — Acquiring Credentials';
    case 'pairing':
      return 'Pairing…';
    default:
      return status.replace(/_/g, ' ');
  }
}

/** BrightSign LCD: XT pairing runs only inside the independent HDMI-1 widget. */
function DevicePairingLcd() {
  const { deviceInfo, loading, error } = useDeviceContext();
  const { pairingCode, registrationStatus, retryPairing, isReady, needsCredentials } =
    usePairing();
  const { syncState } = useSync();
  const profile = deviceInfo?.hardwareProfile ?? runtimeConfig.hardwareProfile;

  let body: ReactNode;

  if (isReady) {
    body = (
      <main className="flex h-full flex-col items-center justify-center gap-8 bg-black p-10 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.4em] text-cyan-400">Perform6</p>
        <h1 className="text-4xl font-semibold sm:text-5xl">Device ready</h1>
        <p className="max-w-xl text-lg text-white/70">Credentials acquired. Opening runtime…</p>
        {deviceInfo && (
          <Link
            to={getPostRegistrationRoute(deviceInfo.hardwareProfile)}
            className="rounded-xl bg-cyan-400 px-10 py-4 text-lg font-semibold text-black"
          >
            Open Runtime UI
          </Link>
        )}
      </main>
    );
  } else if (pairingCode) {
    body = (
      <main className="flex h-full flex-col items-center justify-center gap-10 bg-black px-10 py-12 text-white">
        <PairingCodeDisplay
          code={pairingCode}
          status={registrationStatus}
          clusterMember={deviceInfo?.clusterMember}
          lcd
          model={deviceInfo?.model}
          serialNumber={deviceInfo?.serialNumber}
        />
        {needsCredentials && (
          <div className="w-full max-w-xl">
            <CredentialInjectionForm />
          </div>
        )}
      </main>
    );
  } else if (registrationStatus === 'error' || syncState.error || error) {
    body = (
      <main className="flex h-full flex-col items-center justify-center gap-8 bg-black px-10 py-12 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.4em] text-cyan-400">Perform6</p>
        <h1 className="text-4xl font-semibold text-red-300">Pairing failed</h1>
        <p className="max-w-2xl text-xl text-white/80">
          {syncState.error || error || 'Could not get a pairing code from the server.'}
        </p>
        {deviceInfo && (
          <p className="font-mono text-base text-white/45">
            {deviceInfo.model} · {deviceInfo.serialNumber}
          </p>
        )}
        <button
          type="button"
          className="rounded-xl bg-cyan-400 px-10 py-4 text-lg font-semibold text-black"
          onClick={retryPairing}
        >
          Retry pairing
        </button>
      </main>
    );
  } else {
    body = (
      <main className="flex h-full flex-col items-center justify-center gap-6 bg-black px-10 py-12 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.4em] text-cyan-400">Perform6</p>
        <h1 className="text-4xl font-semibold sm:text-5xl">
          {loading || !deviceInfo
            ? 'Collecting device information…'
            : registrationStatus === 'pairing'
              ? 'Requesting pairing code…'
              : 'Starting pairing…'}
        </h1>
        <p className="max-w-xl text-lg text-white/65">
          {deviceInfo
            ? `${deviceInfo.model} · ${deviceInfo.serialNumber}`
            : 'Reading BrightSign hardware identity and contacting Perform6.'}
        </p>
      </main>
    );
  }

  return <PrimaryOutputOnly profile={profile}>{body}</PrimaryOutputOnly>;
}

export default function Pairing() {
  const { deviceInfo, loading, error } = useDeviceContext();
  const {
    pairingCode,
    pairingId,
    registrationStatus,
    retryPairing,
    isReady,
    needsCredentials,
    pairNextHdDevice,
    hdPairingHistory,
  } = usePairing();
  const { connectionStatus, store, simulatorSessionActive } = useRuntime();
  const { syncState, runSyncNow } = useSync();
  const { lastHeartbeatAt, heartbeatOk } = useHeartbeat();
  const [pairingNext, setPairingNext] = useState(false);
  const [pairNextError, setPairNextError] = useState<string | null>(null);

  const isHdSimulator =
    runtimeConfig.isSimulator && deviceInfo?.hardwareProfile === 'HD226';

  const nextHdMember = useMemo(() => {
    if (!isHdSimulator) return null;
    return resolveNextHdClusterMember(deviceInfo?.clusterMember);
  }, [deviceInfo?.clusterMember, hdPairingHistory, isHdSimulator]);

  const canPairNextHd =
    isHdSimulator &&
    Boolean(nextHdMember) &&
    registrationStatus !== 'pairing' &&
    registrationStatus !== 'idle';

  async function handlePairNextHd() {
    if (!nextHdMember || pairingNext) return;
    setPairingNext(true);
    setPairNextError(null);
    try {
      await pairNextHdDevice(nextHdMember);
    } catch (e) {
      setPairNextError(e instanceof Error ? e.message : 'Failed to pair next HD device');
    } finally {
      setPairingNext(false);
    }
  }

  // Production BrightSign / device builds: LCD-first pairing screen only.
  if (!runtimeConfig.isSimulator) {
    return <DevicePairingLcd />;
  }

  if (!simulatorSessionActive && !pairingCode && registrationStatus === 'idle') {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <h1 className="p6-title">Select a Simulator Profile</h1>
        <p className="max-w-md text-slate-400">
          Choose XT2145, XC4055, or HD226 from the simulator launcher.
        </p>
        <Link
          to="/simulator"
          className="rounded-xl bg-p6-cyan px-8 py-3 text-sm font-semibold text-black"
        >
          Open Simulator Launcher
        </Link>
      </main>
    );
  }

  if (loading && !deviceInfo) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-p6-cyan">Perform6</p>
        <p className="text-2xl font-semibold text-white">Collecting device information…</p>
        <p className="max-w-md text-sm text-slate-400">
          Reading BrightSign hardware identity and starting pairing.
        </p>
      </main>
    );
  }

  return (
    <main className="p6-device-status flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-8">
      <div className="w-full max-w-lg text-center">
        <p className="p6-caption mb-2 text-p6-cyan">Perform6 Runtime</p>
        <h1 className="p6-title mb-2">Device Status</h1>
        <p className="p6-body text-p6-text-muted">{statusLabel(registrationStatus)}</p>
        {isHdSimulator && deviceInfo?.clusterMember ? (
          <p className="mt-2 text-sm text-p6-cyan">
            Pairing as {clusterMemberShortLabel(deviceInfo.clusterMember)} ({deviceInfo.clusterMember})
          </p>
        ) : null}
      </div>

      {(error || syncState.error || pairNextError) && (
        <div
          className="w-full max-w-lg rounded-xl border border-red-500/60 bg-red-950/50 px-5 py-4 text-left"
          role="alert"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-red-300">
            Pairing / API error
          </p>
          <p className="mt-2 text-base text-red-100">
            {syncState.error || error || pairNextError}
          </p>
        </div>
      )}

      {deviceInfo && (
        <dl className="grid w-full max-w-lg gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Device Name</dt>
            <dd>{deviceInfo.deviceName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Model</dt>
            <dd>{deviceInfo.model}</dd>
          </div>
          {deviceInfo.clusterMember ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Cluster Member</dt>
              <dd>{deviceInfo.clusterMember}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Serial</dt>
            <dd className="font-mono text-xs">{deviceInfo.serialNumber}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Pairing ID</dt>
            <dd className="font-mono text-[10px]">{pairingId ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Phase</dt>
            <dd>{syncState.runtimePhase}</dd>
          </div>
        </dl>
      )}

      {!isReady && pairingCode && (
        <PairingCodeDisplay
          code={pairingCode}
          status={registrationStatus}
          clusterMember={deviceInfo?.clusterMember}
          lcd={false}
        />
      )}

      {isHdSimulator && hdPairingHistory.length > 0 && (
        <section className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-left">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            HD codes this session
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Claim each code in Admin → Devices, then add every claimed unit to the HD deployment wizard.
          </p>
          <ul className="divide-y divide-slate-800">
            {hdPairingHistory.map((entry) => (
              <li
                key={entry.clusterMember}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-200">
                    {clusterMemberShortLabel(entry.clusterMember)}
                  </p>
                  <p className="font-mono text-[10px] text-slate-500">{entry.serialNumber}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg tracking-widest text-p6-cyan">
                    {entry.pairingCode}
                  </p>
                  <p className="text-[10px] uppercase text-slate-500">
                    {statusLabel(entry.registrationStatus)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {needsCredentials && <CredentialInjectionForm />}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <StatusBadge
          ok={connectionStatus === 'online'}
          label={`Connection: ${connectionStatus}`}
        />
        {isReady ? (
          <StatusBadge ok={heartbeatOk} label={`Heartbeat: ${heartbeatOk ? 'OK' : 'Failed'}`} />
        ) : (
          <StatusBadge
            ok={registrationStatus === 'waiting_for_registration'}
            label={statusLabel(registrationStatus)}
          />
        )}
      </div>

      {lastHeartbeatAt && isReady && (
        <p className="text-xs text-slate-500">Last heartbeat: {lastHeartbeatAt}</p>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {registrationStatus === 'error' && (
          <button
            type="button"
            className="rounded-xl bg-p6-cyan px-6 py-2 text-sm font-semibold text-black"
            onClick={retryPairing}
          >
            Retry Pairing
          </button>
        )}

        {canPairNextHd && (
          <button
            type="button"
            className="rounded-xl border border-p6-cyan/60 bg-p6-cyan/10 px-6 py-2 text-sm font-semibold text-p6-cyan disabled:opacity-50"
            disabled={pairingNext}
            onClick={() => void handlePairNextHd()}
          >
            {pairingNext
              ? 'Pairing next…'
              : `Pair next HD device (${clusterMemberShortLabel(nextHdMember!)})`}
          </button>
        )}

        {isReady && deviceInfo && (
          <>
            <button
              type="button"
              className="rounded-xl border border-slate-600 px-6 py-2 text-sm"
              onClick={() => void runSyncNow()}
              disabled={syncState.inProgress}
            >
              {syncState.inProgress ? 'Syncing…' : 'Sync Now'}
            </button>
            <Link
              to={getPostRegistrationRoute(deviceInfo.hardwareProfile)}
              className="rounded-xl bg-p6-cyan px-6 py-2 text-sm font-semibold text-black"
            >
              Open Runtime UI
            </Link>
          </>
        )}
      </div>

      {canPairNextHd && (
        <p className="max-w-md text-center text-xs text-slate-500">
          Calls <code className="text-p6-cyan">POST /devices/pair</code> with a new HD226 serial for{' '}
          {nextHdMember}. Previous codes stay listed above for admin claim.
        </p>
      )}

      {store.playbackState.manifest && (
        <p className="text-xs text-slate-500">
          Manifest · {store.playbackState.manifest.screens.length} screen(s) · Day{' '}
          {store.playbackState.manifest.deployment.currentDay}
        </p>
      )}
    </main>
  );
}
