import type {
  ClusterMember,
  DeploymentType,
  DisplayTarget,
  HardwareProfile,
  RuntimeMode,
} from '../shared/types';

function env(key: string, fallback = ''): string {
  return import.meta.env[key]?.trim() ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = env(key);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export const RUNTIME_MODES = ['SIMULATOR', 'BRIGHTSIGN'] as const;
export const HARDWARE_PROFILES = ['XT2145', 'XC4055', 'HD226'] as const;
export const DEPLOYMENT_TYPES = ['TOUCH_SCREEN', 'DISPLAY'] as const;
export const CLUSTER_MEMBERS = [
  'DEVICE_A',
  'DEVICE_B',
  'DEVICE_C',
  'DEVICE_D',
  'DEVICE_E',
  'DEVICE_F',
  'DEVICE_G',
  'DEVICE_H',
  'DEVICE_I',
  'DEVICE_J',
] as const;
export const DISPLAY_TARGETS = ['SCREEN_1', 'SCREEN_2', 'SCREEN_3'] as const;

export interface RuntimeConfig {
  apiBaseUrl: string;
  runtimeMode: RuntimeMode;
  hardwareProfile: HardwareProfile;
  deploymentType: DeploymentType;
  clusterMember: ClusterMember;
  displayTarget: DisplayTarget;
  simSerialNumber: string;
  simModel: string;
  simFirmwareVersion: string;
  simMacAddress: string;
  simIpAddress: string;
  heartbeatIntervalMs: number;
  syncIntervalMs: number;
  pairingPollMs: number;
  runtimeVersion: string;
  isSimulator: boolean;
}

export const runtimeConfig: RuntimeConfig = {
  apiBaseUrl: env('VITE_API_BASE_URL', 'http://localhost:3000/api/v1'),
  runtimeMode: parseEnum(env('VITE_RUNTIME_MODE', 'SIMULATOR'), RUNTIME_MODES, 'SIMULATOR'),
  hardwareProfile: parseEnum(
    env('VITE_HARDWARE_PROFILE', 'XT2145'),
    HARDWARE_PROFILES,
    'XT2145',
  ),
  deploymentType: parseEnum(
    env('VITE_DEPLOYMENT_TYPE', 'TOUCH_SCREEN'),
    DEPLOYMENT_TYPES,
    'TOUCH_SCREEN',
  ),
  clusterMember: parseEnum(env('VITE_CLUSTER_MEMBER', 'DEVICE_A'), CLUSTER_MEMBERS, 'DEVICE_A'),
  displayTarget: parseEnum(env('VITE_DISPLAY_TARGET', 'SCREEN_1'), DISPLAY_TARGETS, 'SCREEN_1'),
  simSerialNumber: env('VITE_SIM_SERIAL_NUMBER'),
  simModel: env('VITE_SIM_MODEL'),
  simFirmwareVersion: env('VITE_SIM_FIRMWARE_VERSION'),
  simMacAddress: env('VITE_SIM_MAC_ADDRESS'),
  simIpAddress: env('VITE_SIM_IP_ADDRESS'),
  heartbeatIntervalMs: envInt('VITE_HEARTBEAT_INTERVAL_MS', 60_000),
  syncIntervalMs: envInt('VITE_SYNC_INTERVAL_MS', 300_000),
  pairingPollMs: envInt('VITE_PAIRING_POLL_MS', 30_000),
  runtimeVersion: env('VITE_RUNTIME_VERSION', '0.1.0'),
  get isSimulator() {
    return this.runtimeMode === 'SIMULATOR';
  },
};

export function profileDefaultDeployment(profile: HardwareProfile): DeploymentType {
  return profile === 'XT2145' ? 'TOUCH_SCREEN' : 'DISPLAY';
}
