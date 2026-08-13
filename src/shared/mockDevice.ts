import { runtimeConfig, profileDefaultDeployment } from '../config/runtime';
import type {
  ClusterMember,
  DeploymentType,
  DeviceInfo,
  DisplayTarget,
  HardwareProfile,
} from '../shared/types';
import {
  readBrightSignDeviceInfo,
  shouldUseBrightSignDeviceApis,
} from '../platform/brightsignDevice';

const STORAGE_PREFIX = 'perform6-sim-serial';

function randomMac(): string {
  return Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join(':');
}

function storageKey(profile: HardwareProfile, clusterMember?: ClusterMember): string {
  if (profile === 'HD226' && clusterMember) {
    return `${STORAGE_PREFIX}-${profile}-${clusterMember}`;
  }
  return `${STORAGE_PREFIX}-${profile}`;
}

function loadStoredSerial(profile: HardwareProfile, clusterMember?: ClusterMember): string | null {
  try {
    return localStorage.getItem(storageKey(profile, clusterMember));
  } catch {
    return null;
  }
}

function persistSerial(
  profile: HardwareProfile,
  serialNumber: string,
  clusterMember?: ClusterMember,
): void {
  try {
    localStorage.setItem(storageKey(profile, clusterMember), serialNumber);
  } catch {
    // BrightSign / private-mode storage can throw — serial still works in-memory this boot.
  }
}

/** Backend expects format like XC4055-001234 */
function createSerialNumber(profile: HardwareProfile): string {
  const suffix = Math.floor(100000 + Math.random() * 900000).toString();
  return `${profile}-${suffix}`;
}

function defaultDeviceName(profile: HardwareProfile, clusterMember?: ClusterMember): string {
  if (profile === 'HD226' && clusterMember) {
    return `Perform6 ${profile} ${clusterMember}`;
  }
  return `Perform6 ${profile} Simulator`;
}

export interface MockDeviceOptions {
  hardwareProfile?: HardwareProfile;
  deploymentType?: DeploymentType;
  clusterMember?: ClusterMember;
  displayTarget?: DisplayTarget;
  serialNumber?: string;
  model?: string;
  deviceName?: string;
  firmwareVersion?: string;
  macAddress?: string;
  ipAddress?: string;
}

export function createMockDeviceInfo(overrides: MockDeviceOptions = {}): DeviceInfo {
  const hardwareProfile = overrides.hardwareProfile ?? runtimeConfig.hardwareProfile;
  const deploymentType =
    overrides.deploymentType ?? profileDefaultDeployment(hardwareProfile);
  const clusterMember =
    hardwareProfile === 'HD226'
      ? (overrides.clusterMember ?? runtimeConfig.clusterMember)
      : undefined;

  const serialNumber =
    overrides.serialNumber ??
    (runtimeConfig.simSerialNumber ||
      loadStoredSerial(hardwareProfile, clusterMember) ||
      createSerialNumber(hardwareProfile));

  persistSerial(hardwareProfile, serialNumber, clusterMember);

  return {
    serialNumber,
    model: overrides.model ?? (runtimeConfig.simModel || hardwareProfile),
    deviceName:
      overrides.deviceName ?? defaultDeviceName(hardwareProfile, clusterMember),
    firmwareVersion:
      overrides.firmwareVersion ?? (runtimeConfig.simFirmwareVersion || '9.0.162'),
    macAddress: overrides.macAddress ?? (runtimeConfig.simMacAddress || randomMac()),
    ipAddress: overrides.ipAddress ?? (runtimeConfig.simIpAddress || '192.168.1.42'),
    hardwareProfile,
    deploymentType,
    clusterMember,
    displayTarget:
      hardwareProfile === 'XC4055'
        ? (overrides.displayTarget ?? runtimeConfig.displayTarget)
        : undefined,
    raw: {
      source: 'simulator',
      runtimeVersion: runtimeConfig.runtimeVersion,
      collectedAt: new Date().toISOString(),
    },
  };
}

export async function collectDeviceInfo(
  overrides: MockDeviceOptions = {},
): Promise<DeviceInfo> {
  if (runtimeConfig.isSimulator) {
    return createMockDeviceInfo(overrides);
  }

  if (shouldUseBrightSignDeviceApis()) {
    const real = readBrightSignDeviceInfo(overrides);
    if (real) {
      console.info('[Perform6] Device info from BSDeviceInfo', {
        model: real.model,
        serialNumber: real.serialNumber,
        macAddress: real.macAddress,
        firmwareVersion: real.firmwareVersion,
      });
      return real;
    }
    console.warn('[Perform6] Falling back to baked profile device info (no BSDeviceInfo)');
  }

  return createMockDeviceInfo({
    ...overrides,
    serialNumber: overrides.serialNumber ?? (runtimeConfig.simSerialNumber || undefined),
    ipAddress: overrides.ipAddress ?? '',
  });
}
