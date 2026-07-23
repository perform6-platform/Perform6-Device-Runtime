import { runtimeConfig } from '../config/runtime';
import type { DeviceInfo, DeviceRegistrationStatus } from '../shared/types';
import { apiFetchData, ApiError } from './api';

export class PairingConflictError extends Error {
  constructor(message = 'Device already registered') {
    super(message);
    this.name = 'PairingConflictError';
  }
}

/** Request body for POST /api/v1/devices/pair (PairDeviceDto) */
export interface PairDevicePayload {
  serialNumber: string;
  model: string;
  firmwareVersion: string;
  deviceName: string;
  ipAddress: string;
  macAddress: string;
  hardwareInfo: Record<string, unknown>;
}

/** Response data from POST /api/v1/devices/pair */
export interface PairDeviceResponseData {
  pairingId: string;
  pairingCode: string;
  serialNumber: string;
  deviceName: string;
  status: string;
  lanIpAddress?: string;
  publicIp?: string;
  location?: string | null;
  timezone?: string | null;
  locationSource?: string | null;
  expiresAt?: string;
  deviceId?: string;
  apiToken?: string;
}

export interface NormalizedPairingResult {
  pairingId: string;
  pairingCode: string;
  registrationStatus: DeviceRegistrationStatus;
  rawStatus: string;
  deviceId?: string;
  apiToken?: string;
}

export function deviceInfoToPairPayload(device: DeviceInfo): PairDevicePayload {
  const hardwareInfo: Record<string, unknown> = {
    hardwareProfile: device.hardwareProfile,
    deploymentType: device.deploymentType,
    runtimeMode: runtimeConfig.runtimeMode,
    simulator: runtimeConfig.isSimulator,
  };

  if (device.hardwareProfile === 'XC4055') {
    hardwareInfo.screenCount = 3;
  }
  if (device.clusterMember) hardwareInfo.clusterMember = device.clusterMember;
  if (device.displayTarget) hardwareInfo.displayTarget = device.displayTarget;

  return {
    serialNumber: device.serialNumber,
    model: device.model,
    firmwareVersion: device.firmwareVersion,
    deviceName: device.deviceName,
    ipAddress: device.ipAddress,
    macAddress: device.macAddress,
    hardwareInfo,
  };
}

export function mapPairingApiStatus(apiStatus: string): DeviceRegistrationStatus {
  switch (apiStatus.toUpperCase()) {
    case 'REGISTERED':
    case 'ACTIVE':
      return 'registered';
    case 'ADMIN_CLAIMED':
      return 'paired';
    case 'ONLINE':
    case 'PENDING':
    case 'AWAITING':
      return 'waiting_for_registration';
    default:
      return 'waiting_for_registration';
  }
}

export function normalizePairResponse(data: PairDeviceResponseData): NormalizedPairingResult {
  return {
    pairingId: data.pairingId,
    pairingCode: data.pairingCode,
    registrationStatus: mapPairingApiStatus(data.status),
    rawStatus: data.status,
    deviceId: data.deviceId,
    apiToken: data.apiToken,
  };
}

export async function pairDevice(device: DeviceInfo): Promise<NormalizedPairingResult> {
  try {
    const data = await apiFetchData<PairDeviceResponseData>('/devices/pair', {
      method: 'POST',
      body: JSON.stringify(deviceInfoToPairPayload(device)),
    });
    return normalizePairResponse(data);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      throw new PairingConflictError(e.message);
    }
    throw e;
  }
}

export interface PairingLifecycleStatusData {
  pairingId: string;
  pairingCode: string;
  serialNumber: string;
  status: string;
  registrationStatus?: string;
  registeredDeviceId?: string | null;
  credentialsAvailable?: boolean;
  isOnline?: boolean;
  expiresAt?: string;
}

export function mapLifecycleRegistrationStatus(
  data: Pick<PairingLifecycleStatusData, 'status' | 'registrationStatus'>,
): DeviceRegistrationStatus {
  const reg = data.registrationStatus?.toUpperCase();
  if (reg === 'REGISTERED') return 'registered';
  if (reg === 'ADMIN_CLAIMED') return 'paired';
  return mapPairingApiStatus(data.status);
}

export async function getPairingLifecycleStatus(
  serialNumber: string,
): Promise<PairingLifecycleStatusData> {
  const params = new URLSearchParams({ serialNumber });
  return apiFetchData<PairingLifecycleStatusData>(
    `/devices/pairings/status?${params.toString()}`,
  );
}

/** Ensure we have a valid pairingId UUID before credential fetch. */
export async function resolvePairingIdentity(
  device: DeviceInfo,
): Promise<NormalizedPairingResult> {
  try {
    const lifecycle = await getPairingLifecycleStatus(device.serialNumber);
    return {
      pairingId: lifecycle.pairingId,
      pairingCode: lifecycle.pairingCode,
      registrationStatus: mapLifecycleRegistrationStatus(lifecycle),
      rawStatus: lifecycle.registrationStatus ?? lifecycle.status,
      deviceId: lifecycle.registeredDeviceId ?? undefined,
    };
  } catch {
    return pairDevice(device);
  }
}

export async function pollPairingStatus(device: DeviceInfo): Promise<NormalizedPairingResult> {
  try {
    const lifecycle = await getPairingLifecycleStatus(device.serialNumber);
    return {
      pairingId: lifecycle.pairingId,
      pairingCode: lifecycle.pairingCode,
      registrationStatus: mapLifecycleRegistrationStatus(lifecycle),
      rawStatus: lifecycle.registrationStatus ?? lifecycle.status,
      deviceId: lifecycle.registeredDeviceId ?? undefined,
    };
  } catch {
    return pairDevice(device);
  }
}
