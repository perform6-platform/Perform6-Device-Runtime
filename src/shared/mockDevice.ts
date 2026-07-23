import { runtimeConfig, profileDefaultDeployment } from '../config/runtime';
import type {
  ClusterMember,
  DeploymentType,
  DeviceInfo,
  DisplayTarget,
  HardwareProfile,
} from '../shared/types';

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
  localStorage.setItem(storageKey(profile, clusterMember), serialNumber);
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
  };
}

export async function collectDeviceInfo(
  overrides: MockDeviceOptions = {},
): Promise<DeviceInfo> {
  if (runtimeConfig.isSimulator) {
    return createMockDeviceInfo(overrides);
  }

  // BrightSign hardware: extend with brightsign platform APIs later
  return createMockDeviceInfo(overrides);
}
