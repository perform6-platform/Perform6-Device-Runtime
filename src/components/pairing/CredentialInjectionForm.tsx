import { useState } from 'react';
import { useDeviceContext } from '../../contexts/DeviceContext';
import { useRuntimeContext } from '../../contexts/RuntimeContext';
import { useSync } from '../../hooks/useRuntime';
import { runtimeConfig } from '../../config/runtime';

export function CredentialInjectionForm() {
  const { deviceInfo } = useDeviceContext();
  const { needsCredentials, fetchCredentials, resolveCredentials } = useRuntimeContext();
  const { syncState } = useSync();
  const [resolveDeviceId, setResolveDeviceId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  if (!needsCredentials) return null;

  const handleResolve = async () => {
    const id = resolveDeviceId.trim();
    if (!id) {
      setLocalError('Enter a valid Device ID (UUID) for resolve.');
      return;
    }
    setResolving(true);
    setLocalError(null);
    try {
      await resolveCredentials(id);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Resolve failed');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="w-full max-w-lg rounded-xl border border-amber-700/50 bg-amber-950/20 p-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-300">
        Acquiring Device Credentials
      </h2>

      {syncState.credentialsFetching ? (
        <p className="text-sm text-p6-cyan">Fetching credentials from backend…</p>
      ) : (
        <p className="text-sm text-slate-300">
          Admin registration complete. Runtime is calling{' '}
          <code className="text-p6-cyan">POST /devices/pairings/credentials</code> with your{' '}
          <strong>pairingId</strong> + <strong>serialNumber</strong>.
        </p>
      )}

      {syncState.credentialsError && (
        <p className="mt-3 text-xs text-red-400">{syncState.credentialsError}</p>
      )}

      <button
        type="button"
        disabled={syncState.credentialsFetching}
        onClick={() => void fetchCredentials()}
        className="mt-4 w-full rounded-xl bg-p6-cyan py-2.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {syncState.credentialsFetching ? 'Fetching…' : 'Retry Credential Fetch'}
      </button>

      {runtimeConfig.isSimulator && (
        <div className="mt-4 border-t border-slate-700 pt-4">
          <button
            type="button"
            className="text-xs text-slate-400 underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide' : 'Show'} simulator resolve fallback
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-slate-500">
                If you have <strong>deviceId</strong> from Admin register response, use{' '}
                <code>POST /devices/credentials/resolve</code> with serial{' '}
                <code className="text-p6-cyan">{deviceInfo?.serialNumber}</code>
              </p>
              <input
                type="text"
                value={resolveDeviceId}
                onChange={(e) => setResolveDeviceId(e.target.value)}
                placeholder="deviceId UUID"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm"
              />
              {localError && <p className="text-xs text-red-400">{localError}</p>}
              <button
                type="button"
                disabled={resolving || syncState.credentialsFetching}
                onClick={() => void handleResolve()}
                className="w-full rounded-lg border border-slate-600 py-2 text-sm text-slate-200 disabled:opacity-50"
              >
                {resolving ? 'Resolving…' : 'Resolve Credentials'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
