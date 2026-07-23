import { Link } from 'react-router-dom';
import { runtimeConfig } from '../config/runtime';
import { getDisplayRoute } from '../services/runtime';
import { useHeartbeat, useRuntime, useSync } from '../hooks/useRuntime';

export default function RuntimeDashboard() {
  const { deviceInfo, store, registrationStatus, pairingCode, isReady } = useRuntime();
  const { syncState } = useSync();
  const { lastHeartbeatAt, heartbeatOk } = useHeartbeat();
  const manifest = store.playbackState.manifest;
  const deployment = manifest?.deployment;

  return (
    <main className="p6-dashboard flex h-full flex-col gap-4 overflow-y-auto p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-p6-cyan">Runtime Dashboard</p>
          <h1 className="text-2xl font-bold">Perform6 Player</h1>
          <p className="text-sm text-slate-500">
            {runtimeConfig.runtimeMode} · {runtimeConfig.apiBaseUrl}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/pairing" className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
            Device Status
          </Link>
          {runtimeConfig.isSimulator && (
            <Link to="/simulator" className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
              Simulator
            </Link>
          )}
          {deviceInfo && (
            <Link
              to={getDisplayRoute(deviceInfo.hardwareProfile)}
              className="rounded-lg bg-p6-cyan px-3 py-2 text-xs font-semibold text-black"
            >
              Open Runtime UI
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            Current Device
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Model</dt>
              <dd>{deviceInfo?.model ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Serial</dt>
              <dd className="font-mono text-xs">{deviceInfo?.serialNumber ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Profile</dt>
              <dd>{deviceInfo?.hardwareProfile ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            Pairing
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd className="capitalize">{registrationStatus.replace(/_/g, ' ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Code</dt>
              <dd className="font-mono">{pairingCode ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Registered</dt>
              <dd>{isReady ? 'Yes (credentials stored)' : registrationStatus}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Runtime Phase</dt>
              <dd>{syncState.runtimePhase}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            Sync
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Required</dt>
              <dd>{syncState.syncRequired ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Config</dt>
              <dd className="font-mono text-xs">{syncState.configVersion ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Manifest</dt>
              <dd className="font-mono text-xs">{syncState.manifestVersion ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Last Sync</dt>
              <dd className="text-xs">{syncState.lastSyncAt ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            Heartbeat
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>{heartbeatOk ? 'OK' : isReady ? 'Failed' : 'Pending'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Last</dt>
              <dd className="text-xs">{lastHeartbeatAt ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 md:col-span-2">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            Current Deployment
          </h2>
          {deployment ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4 sm:flex-col sm:justify-start">
                <dt className="text-slate-500">Name</dt>
                <dd>{deployment.name}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:flex-col sm:justify-start">
                <dt className="text-slate-500">Library</dt>
                <dd>{deployment.libraryName}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:flex-col sm:justify-start">
                <dt className="text-slate-500">Day</dt>
                <dd>
                  {deployment.currentDay ?? '—'}
                  {deployment.totalDays ? ` / ${deployment.totalDays}` : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:flex-col sm:justify-start">
                <dt className="text-slate-500">Current Video</dt>
                <dd>{store.playbackState.currentVideo?.title ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No manifest loaded yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
