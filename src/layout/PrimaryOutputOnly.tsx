import type { ReactNode } from 'react';
import type { HardwareProfile } from '../shared/types';

/**
 * BrightSign multi-HDMI canvas layout helpers.
 * Autorun SetScreenModes maps equal-width columns to physical HDMI ports
 * so each LED sees full-screen content (not a tiled “pane” UI on one panel).
 */
export type OutputSlotCount = 1 | 2 | 3;

export function outputSlotCountForProfile(profile: HardwareProfile): OutputSlotCount {
  switch (profile) {
    case 'XT2145':
      return 2;
    case 'XC4055':
      return 3;
    case 'HD226':
    default:
      return 1;
  }
}

/** Tailwind flex fraction for one HDMI column on the multi-output canvas. */
export function outputColumnClass(slots: OutputSlotCount): string {
  if (slots === 2) return 'h-full min-w-0 flex-1';
  if (slots === 3) return 'h-full min-w-0 flex-1';
  return 'h-full w-full';
}

/**
 * Wrap primary UI (pairing / status) so it appears only on HDMI-1.
 * Secondary HDMI columns stay black until runtime content mounts.
 */
export function PrimaryOutputOnly({
  profile,
  children,
}: {
  profile: HardwareProfile;
  children: ReactNode;
}) {
  const slots = outputSlotCountForProfile(profile);
  if (slots === 1) {
    return <>{children}</>;
  }

  const extras = slots - 1;
  return (
    <div className="flex h-full w-full flex-row overflow-hidden bg-black">
      <div className={outputColumnClass(slots)}>{children}</div>
      {Array.from({ length: extras }, (_, i) => (
        <div key={i} className={`${outputColumnClass(slots)} bg-black`} aria-hidden />
      ))}
    </div>
  );
}
