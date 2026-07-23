import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runtimeConfig } from '../config/runtime';
import { useRuntimeContext } from '../contexts/RuntimeContext';
import type { HardwareProfile } from '../shared/types';
import { profileDefaultDeployment } from '../config/runtime';

const PROFILES: { id: HardwareProfile; title: string; description: string; route: string }[] = [
  {
    id: 'XT2145',
    title: 'XT2145 Touch Screen',
    description: 'Touch UI + external display mirror simulation',
    route: '/simulator/xt2145',
  },
  {
    id: 'XC4055',
    title: 'XC4055 Display Deployment',
    description: 'Three HDMI outputs — Start Here, Phase 1, Phase 2',
    route: '/simulator/xc4055',
  },
  {
    id: 'HD226',
    title: 'HD226 Cluster',
    description:
      '1–10 independent players. After each code is claimed, use “Pair next HD device” for the next serial.',
    route: '/simulator/hd226/device_a',
  },
];

export default function SimulatorLauncher() {
  const navigate = useNavigate();
  const { beginSimulatorProfile } = useRuntimeContext();
  const [busyProfile, setBusyProfile] = useState<HardwareProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectProfile = async (profile: HardwareProfile, route: string) => {
    setBusyProfile(profile);
    setError(null);
    try {
      await beginSimulatorProfile({
        hardwareProfile: profile,
        deploymentType: profileDefaultDeployment(profile),
        clusterMember: profile === 'HD226' ? 'DEVICE_A' : undefined,
        displayTarget: profile === 'XC4055' ? 'SCREEN_1' : undefined,
        route,
        resetHdPairingSession: profile === 'HD226',
      });
      navigate('/pairing', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start simulator profile');
    } finally {
      setBusyProfile(null);
    }
  };

  return (
    <main className="p6-simulator-launcher flex h-full flex-col items-center justify-center gap-8 overflow-y-auto p-8">
      <div className="max-w-2xl text-center">
        <p className="p6-caption mb-2 text-p6-cyan">Perform6 Runtime Simulator</p>
        <h1 className="p6-title mb-3">Select Hardware Profile</h1>
        <p className="p6-body text-p6-text-muted">
          Browser acts as BrightSign hardware. Selecting a profile collects device info and calls{' '}
          <code className="text-p6-cyan">POST /devices/pair</code> to generate a pairing code.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Mode: {runtimeConfig.runtimeMode} · API: {runtimeConfig.apiBaseUrl}
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid w-full max-w-4xl gap-4 md:grid-cols-3">
        {PROFILES.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busyProfile !== null}
            className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 text-left transition hover:border-p6-cyan hover:bg-slate-900 disabled:opacity-50"
            onClick={() => void selectProfile(p.id, p.route)}
          >
            <h2 className="p6-heading mb-2 text-p6-cyan">{p.title}</h2>
            <p className="p6-body text-sm text-p6-text-muted">{p.description}</p>
            {busyProfile === p.id && (
              <p className="mt-3 text-xs text-p6-cyan">Collecting info & pairing…</p>
            )}
          </button>
        ))}
      </div>
    </main>
  );
}
