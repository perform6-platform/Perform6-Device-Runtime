import type { ClusterMember } from '../../shared/types';
import { clusterMemberShortLabel } from '../../simulator/hdClusterPairing';

interface PairingCodeDisplayProps {
  code: string;
  status: string;
  clusterMember?: ClusterMember;
  /** Full-bleed LCD layout for BrightSign / TV (default true). */
  lcd?: boolean;
  serialNumber?: string;
  model?: string;
}

function statusHint(status: string): string {
  switch (status) {
    case 'waiting_for_registration':
      return 'Enter this code in Admin → Devices to claim this player.';
    case 'paired':
      return 'Admin claimed — waiting for deployment.';
    case 'registered':
      return 'Registered — acquiring credentials…';
    case 'pairing':
      return 'Requesting a new pairing code…';
    default:
      return status.replace(/_/g, ' ');
  }
}

/** Large pairing code for LCD / BrightSign displays. */
export function PairingCodeDisplay({
  code,
  status,
  clusterMember,
  lcd = true,
  serialNumber,
  model,
}: PairingCodeDisplayProps) {
  const digits = (code || '------').trim();

  if (!lcd) {
    return (
      <div className="p6-pairing-code flex flex-col items-center gap-4">
        <p className="p6-caption text-p6-text-muted uppercase tracking-widest">Pairing Code</p>
        {clusterMember ? (
          <p className="text-sm font-semibold text-p6-cyan">
            {clusterMemberShortLabel(clusterMember)} · {clusterMember}
          </p>
        ) : null}
        <div className="p6-pairing-code__digits font-mono text-5xl font-bold tracking-[0.35em] text-p6-cyan">
          {digits}
        </div>
        <p className="p6-body text-p6-text-muted capitalize">{status.replace(/_/g, ' ')}</p>
      </div>
    );
  }

  return (
    <div
      className="flex w-full max-w-5xl flex-col items-center gap-6 text-center"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-bold uppercase tracking-[0.4em] text-cyan-400 sm:text-base">
        Perform6
      </p>
      <h1 className="text-3xl font-semibold text-white sm:text-5xl">Pairing Code</h1>
      {clusterMember ? (
        <p className="text-lg font-semibold text-cyan-300">
          {clusterMemberShortLabel(clusterMember)} · {clusterMember}
        </p>
      ) : null}
      <div
        className="font-mono text-7xl font-bold leading-none tracking-[0.28em] text-cyan-400 sm:text-8xl md:text-[7.5rem]"
        style={{ letterSpacing: '0.28em' }}
      >
        {digits}
      </div>
      <p className="max-w-2xl text-xl text-white/75 sm:text-2xl">{statusHint(status)}</p>
      {(model || serialNumber) && (
        <p className="font-mono text-base text-white/45 sm:text-lg">
          {[model, serialNumber].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
