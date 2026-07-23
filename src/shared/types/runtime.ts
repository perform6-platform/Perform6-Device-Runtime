export type RuntimeMode = 'SIMULATOR' | 'BRIGHTSIGN';

export type HardwareProfile = 'XT2145' | 'XC4055' | 'HD226';

export type DeploymentType = 'TOUCH_SCREEN' | 'DISPLAY';

export type ClusterMember =
  | 'DEVICE_A'
  | 'DEVICE_B'
  | 'DEVICE_C'
  | 'DEVICE_D'
  | 'DEVICE_E'
  | 'DEVICE_F'
  | 'DEVICE_G'
  | 'DEVICE_H'
  | 'DEVICE_I'
  | 'DEVICE_J';

export type DisplayTarget = 'SCREEN_1' | 'SCREEN_2' | 'SCREEN_3';

export type DeviceRegistrationStatus =
  | 'idle'
  | 'pairing'
  | 'waiting_for_registration'
  | 'paired'
  | 'registered'
  | 'error';

export type ConnectionStatus = 'online' | 'offline' | 'connecting';

export interface DeviceInfo {
  serialNumber: string;
  model: string;
  deviceName: string;
  firmwareVersion: string;
  macAddress: string;
  ipAddress: string;
  hardwareProfile: HardwareProfile;
  deploymentType: DeploymentType;
  clusterMember?: ClusterMember;
  displayTarget?: DisplayTarget;
}

export interface PairingResponse {
  pairingId: string;
  pairingCode: string;
  token?: string;
  status: string;
  registrationStatus: DeviceRegistrationStatus;
}

export interface DeviceStatusResponse {
  pairingId: string;
  status: string;
  pairingCode?: string;
  registeredAt?: string;
  deviceId?: string;
  apiToken?: string;
}

export interface HeartbeatPayload {
  deviceId: string;
  timestamp: string;
  uptimeSeconds: number;
  connectionStatus: ConnectionStatus;
}

export interface SyncCheckResponse {
  syncRequired: boolean;
  configVersion: string;
  manifestVersion: string;
  lastSyncAt?: string;
}

export interface DeploymentConfig {
  id: string;
  name: string;
  libraryId: string;
  libraryName: string;
  brandingUrl?: string;
  rotationId?: string;
  currentDay?: number;
  totalDays?: number;
}

export interface MediaAsset {
  id: string;
  type: 'video' | 'image';
  url: string;
  title: string;
  durationSeconds?: number;
  loop?: boolean;
}

export interface PlaybackManifest {
  version: string;
  deployment: DeploymentConfig;
  screens: PlaybackScreen[];
  updatedAt: string;
}

export interface PlaybackScreen {
  id: string;
  label: string;
  displayTarget?: DisplayTarget;
  clusterMember?: ClusterMember;
  currentVideo?: MediaAsset;
  playlist: MediaAsset[];
  rotationDay?: number;
}

export interface SyncState {
  lastCheckAt: string | null;
  lastSyncAt: string | null;
  syncJobId: string | null;
  configVersion: string | null;
  manifestVersion: string | null;
  syncRequired: boolean;
  inProgress: boolean;
  error: string | null;
  runtimePhase: RuntimePhase;
  credentialsFetching: boolean;
  credentialsError: string | null;
}

export type RuntimePhase =
  | 'unpaired'
  | 'waiting_claim'
  | 'waiting_register'
  | 'waiting_credentials'
  | 'syncing'
  | 'ready'
  | 'playing'
  | 'error';

export interface PlaybackState {
  manifest: PlaybackManifest | null;
  currentScreenId: string | null;
  currentVideo: MediaAsset | null;
  isPlaying: boolean;
  displayVideoSrc: string | null;
}

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  category: 'device' | 'pairing' | 'sync' | 'heartbeat' | 'playback' | 'runtime';
  message: string;
  data?: unknown;
}
