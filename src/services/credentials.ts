import { apiFetchData, ApiError } from './api';

/** Response from POST /devices/pairings/credentials and POST /devices/credentials/resolve */
export interface DeviceCredentialsData {
  deviceId: string;
  apiToken: string;
  pairingId?: string;
  serialNumber?: string;
  status?: string;
}

export class CredentialsNotReadyError extends Error {
  constructor(
    message = 'Credentials not available yet — complete admin registration first',
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'CredentialsNotReadyError';
  }
}

function wrapCredentialError(e: unknown): never {
  if (e instanceof ApiError) {
    if (e.status === 404 || e.status === 403 || e.status === 409) {
      throw new CredentialsNotReadyError(e.message, e.status);
    }
  }
  throw e;
}

/**
 * Primary path after REGISTERED: prove identity with pairingId + serialNumber.
 * POST /devices/pairings/credentials [@Public]
 */
export async function fetchPairingCredentials(
  pairingId: string,
  serialNumber: string,
): Promise<DeviceCredentialsData> {
  try {
    return await apiFetchData<DeviceCredentialsData>('/devices/pairings/credentials', {
      method: 'POST',
      body: JSON.stringify({ pairingId, serialNumber }),
    });
  } catch (e) {
    wrapCredentialError(e);
  }
}

/**
 * Simulator / recovery path when deviceId is known (e.g. from admin register response).
 * POST /devices/credentials/resolve [@Public]
 */
export async function resolveDeviceCredentials(
  deviceId: string,
  serialNumber: string,
): Promise<DeviceCredentialsData> {
  try {
    return await apiFetchData<DeviceCredentialsData>('/devices/credentials/resolve', {
      method: 'POST',
      body: JSON.stringify({ deviceId, serialNumber }),
    });
  } catch (e) {
    wrapCredentialError(e);
  }
}

export interface AcquireCredentialsInput {
  serialNumber: string;
  pairingId?: string | null;
  deviceId?: string | null;
}

/**
 * Tries pairing credentials first, then resolve fallback if deviceId provided.
 */
export async function acquireDeviceCredentials(
  input: AcquireCredentialsInput,
): Promise<DeviceCredentialsData> {
  const { serialNumber, pairingId, deviceId } = input;

  if (pairingId) {
    try {
      return await fetchPairingCredentials(pairingId, serialNumber);
    } catch (e) {
      if (deviceId && e instanceof CredentialsNotReadyError) {
        return resolveDeviceCredentials(deviceId, serialNumber);
      }
      throw e;
    }
  }

  if (deviceId) {
    return resolveDeviceCredentials(deviceId, serialNumber);
  }

  throw new Error('pairingId or deviceId is required to acquire credentials');
}
