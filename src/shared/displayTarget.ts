import type { DisplayTarget, HardwareProfile } from './types/runtime';

/** Runtime internal → backend sync header/body value */
export function toBackendDisplayTarget(target: DisplayTarget): string {
  switch (target) {
    case 'SCREEN_1':
      return 'HDMI1';
    case 'SCREEN_2':
      return 'HDMI2';
    case 'SCREEN_3':
      return 'HDMI3';
    default:
      return 'HDMI1';
  }
}

export function fromBackendDisplayTarget(hdmi: string): DisplayTarget | undefined {
  switch (hdmi.toUpperCase()) {
    case 'HDMI1':
    case 'SCREEN_1':
      return 'SCREEN_1';
    case 'HDMI2':
    case 'SCREEN_2':
      return 'SCREEN_2';
    case 'HDMI3':
    case 'SCREEN_3':
      return 'SCREEN_3';
    default:
      return undefined;
  }
}

export function defaultDisplayTargetForProfile(profile: HardwareProfile): DisplayTarget {
  return profile === 'XC4055' ? 'SCREEN_1' : 'SCREEN_1';
}

export const XC4055_HDMI_TARGETS = ['HDMI1', 'HDMI2', 'HDMI3'] as const;

/** Fallback only when sync has not yet provided category labels. */
export const XC4055_SCREEN_FALLBACK_LABELS: Record<DisplayTarget, string> = {
  SCREEN_1: 'Screen 1',
  SCREEN_2: 'Screen 2',
  SCREEN_3: 'Screen 3',
};

/** @deprecated Prefer category labels from runtime manifest. */
export const XC4055_SCREEN_LABELS: Record<string, string> = {
  HDMI1: 'Screen 1',
  HDMI2: 'Screen 2',
  HDMI3: 'Screen 3',
  SCREEN_1: 'Screen 1',
  SCREEN_2: 'Screen 2',
  SCREEN_3: 'Screen 3',
};
