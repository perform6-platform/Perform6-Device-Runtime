import { saveCredentials } from './credentialStore';
import {
  acquireDeviceCredentials,
  CredentialsNotReadyError,
  type DeviceCredentialsData,
} from './credentials';
import { resolvePairingIdentity } from './pairing';
import type { DeviceInfo } from '../shared/types';
import { useDeviceStore } from '../stores/deviceStore';

export interface CredentialFetchInput {
  serialNumber: string;
  pairingId?: string | null;
  deviceId?: string | null;
  deviceInfo?: DeviceInfo;
}

export interface CredentialFetchResult {
  success: boolean;
  credentials?: DeviceCredentialsData;
  notReady?: boolean;
  error?: string;
  resolvedPairingId?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidPairingId(id: string | null | undefined): id is string {
  return !!id && UUID_RE.test(id);
}

async function resolveIdsForCredentialFetch(
  input: CredentialFetchInput,
): Promise<{ pairingId?: string; deviceId?: string; serialNumber: string }> {
  let pairingId = input.pairingId ?? undefined;
  let deviceId = input.deviceId ?? undefined;
  const serialNumber = input.serialNumber;

  // Migrate legacy persisted state: pairingId was stored as deviceId
  const store = useDeviceStore.getState();
  if (!isValidPairingId(pairingId) && isValidPairingId(store.deviceId) && !store.hasCredentials) {
    pairingId = store.deviceId!;
  }
  if (!isValidPairingId(pairingId) && isValidPairingId(store.pairingId)) {
    pairingId = store.pairingId!;
  }

  // Refresh from backend when pairingId missing or invalid (e.g. sim- prefix)
  if (input.deviceInfo && !isValidPairingId(pairingId)) {
    const resolved = await resolvePairingIdentity(input.deviceInfo);
    pairingId = resolved.pairingId;
    deviceId = deviceId ?? resolved.deviceId;
    useDeviceStore.getState().setPairing({
      pairingId: resolved.pairingId,
      pairingCode: resolved.pairingCode,
      registrationStatus: resolved.registrationStatus,
    });
  }

  return { pairingId, deviceId, serialNumber };
}

/** Fetch and persist device credentials from backend public APIs. */
export async function fetchAndStoreCredentials(
  input: CredentialFetchInput,
): Promise<CredentialFetchResult> {
  try {
    const ids = await resolveIdsForCredentialFetch(input);

    if (!isValidPairingId(ids.pairingId) && !ids.deviceId) {
      return {
        success: false,
        error: 'pairingId missing — re-pair device or wait for registration',
      };
    }

    const credentials = await acquireDeviceCredentials({
      serialNumber: ids.serialNumber,
      pairingId: ids.pairingId,
      deviceId: ids.deviceId,
    });

    if (!credentials.deviceId || !credentials.apiToken) {
      return {
        success: false,
        error: 'Credentials response missing deviceId or apiToken',
      };
    }

    saveCredentials({
      deviceId: credentials.deviceId,
      apiToken: credentials.apiToken,
    });

    return {
      success: true,
      credentials,
      resolvedPairingId: ids.pairingId,
    };
  } catch (e) {
    if (e instanceof CredentialsNotReadyError) {
      return { success: false, notReady: true, error: e.message };
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Credential fetch failed',
    };
  }
}
