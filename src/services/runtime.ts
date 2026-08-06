import { runtimeConfig } from '../config/runtime';
import type { HardwareProfile } from '../shared/types';

export function getTouchScreenRoute(): string {
  return '/touch';
}

/** Real-device display routes (also used by simulator after profile pick). */
export function getDisplayRoute(profile: HardwareProfile): string {
  switch (profile) {
    case 'XC4055':
      return '/display/xc4055';
    case 'HD226':
      return '/display/hd226';
    case 'XT2145':
    default:
      return getTouchScreenRoute();
  }
}

export function getPostRegistrationRoute(profile: HardwareProfile): string {
  if (runtimeConfig.isSimulator) {
    // Simulator chrome: split XT layout + multi-pane XC/HD previews
    if (profile === 'XT2145') return '/simulator/xt2145';
    if (profile === 'XC4055') return '/simulator/xc4055';
    if (profile === 'HD226') {
      return `/simulator/hd226/${runtimeConfig.clusterMember.toLowerCase()}`;
    }
  }

  // BrightSign / production builds
  if (profile === 'XC4055' || profile === 'HD226') {
    return getDisplayRoute(profile);
  }
  return getTouchScreenRoute();
}

export function getSimulatorProfiles(): HardwareProfile[] {
  return ['XT2145', 'XC4055', 'HD226'];
}

export function formatUptimeSeconds(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}
