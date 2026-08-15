import { runtimeConfig } from '../../config/runtime';
import { useDeviceContext } from '../../contexts/DeviceContext';
import { usePairing, useSync } from '../../hooks/useRuntime';
import type { HardwareProfile } from '../../shared/types';

/**
 * Physical HDMI port that each canvas column is mapped onto by autorun
 * SetScreenModes (display_x 0 / 1920 / 3840).
 */
const HDMI_LABELS: Record<HardwareProfile, string[]> = {
  XT2145: ['HDMI-1 · TOUCH', 'HDMI-2 · LED'],
  XC4055: ['HDMI-1 · LED 1', 'HDMI-2 · LED 2', 'HDMI-3 · LED 3'],
  HD226: ['HDMI · LED'],
};

function slotCount(profile: HardwareProfile): number {
  return HDMI_LABELS[profile]?.length ?? 1;
}

/** Compact corner strip so HDMI-1 is identifiable without hiding its UI. */
export function OutputBadge({
  profile,
  slotIndex = 0,
}: {
  profile: HardwareProfile;
  slotIndex?: number;
}) {
  if (!runtimeConfig.showOutputDiagnostics) return null;

  const label = HDMI_LABELS[profile]?.[slotIndex] ?? `OUTPUT ${slotIndex + 1}`;
  const canvasOk = window.innerWidth >= 1920 * slotCount(profile) - 8;

  return (
    <div className="pointer-events-none absolute left-0 top-0 z-50 flex items-center gap-3 rounded-br-xl bg-black/80 px-4 py-2 font-mono text-sm text-white/80">
      <span className="font-bold text-cyan-300">{label}</span>
      <span className={canvasOk ? 'text-emerald-300' : 'text-red-300'}>
        {window.innerWidth}x{window.innerHeight}
      </span>
      <span className="text-white/40">v{runtimeConfig.runtimeVersion}</span>
    </div>
  );
}

/**
 * Visible on every HDMI output so a blank panel can be told apart from a panel
 * the compositor never painted. If this renders, the HTML plane reached that
 * output; if the player splash stays instead, the failure is below the app.
 */
export function OutputDiagnostics({
  profile,
  slotIndex,
}: {
  profile: HardwareProfile;
  slotIndex: number;
}) {
  const { deviceInfo, error: deviceError } = useDeviceContext();
  const { pairingCode, registrationStatus } = usePairing();
  const { syncState } = useSync();

  const label = HDMI_LABELS[profile]?.[slotIndex] ?? `OUTPUT ${slotIndex + 1}`;
  const actualCanvas = `${window.innerWidth}x${window.innerHeight}`;
  const expectedWidth = 1920 * slotCount(profile);
  const canvasOk = window.innerWidth >= expectedWidth - 8;
  const failure = syncState.error || deviceError;

  return (
    <section className="flex h-full w-full flex-col justify-between gap-6 bg-black p-10 text-white">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-400">Perform6</p>
        <h2 className="mt-3 text-4xl font-semibold">{label}</h2>
        <p className="mt-2 text-lg text-white/60">
          {profile} · v{runtimeConfig.runtimeVersion}
        </p>
      </div>

      {pairingCode ? (
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">Pairing code</p>
          <p className="font-mono text-7xl font-bold tracking-[0.2em] text-cyan-300">
            {pairingCode}
          </p>
          <p className="mt-2 text-base text-white/60">{registrationStatus.replace(/_/g, ' ')}</p>
        </div>
      ) : (
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">Status</p>
          <p className="text-3xl font-semibold text-amber-300">
            {registrationStatus.replace(/_/g, ' ')}
          </p>
        </div>
      )}

      {failure ? (
        <div className="rounded-xl border-2 border-red-500 bg-red-950/60 p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-red-300">Error</p>
          <p className="mt-2 text-xl text-red-100">{failure}</p>
        </div>
      ) : null}

      <dl className="grid gap-2 border-t border-white/15 pt-5 font-mono text-base">
        <div className="flex justify-between gap-6">
          <dt className="text-white/45">canvas</dt>
          <dd className={canvasOk ? 'text-emerald-300' : 'text-red-300'}>
            {actualCanvas} {canvasOk ? 'OK' : `≠ ${expectedWidth}x1080`}
          </dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-white/45">serial</dt>
          <dd>{deviceInfo?.serialNumber ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-white/45">firmware</dt>
          <dd>{deviceInfo?.firmwareVersion ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-white/45">phase</dt>
          <dd>{syncState.runtimePhase}</dd>
        </div>
      </dl>
    </section>
  );
}
