import { useDeviceStore } from '../stores/deviceStore';
import type { DeviceCredentials } from '../shared/types/api';

export function getCredentials(): DeviceCredentials | null {
  const { deviceId, apiToken, hasCredentials } = useDeviceStore.getState();
  if (!hasCredentials || !deviceId || !apiToken) return null;
  return { deviceId, apiToken };
}

export function saveCredentials(credentials: DeviceCredentials): void {
  useDeviceStore.getState().setCredentials(credentials);
}

export function clearCredentials(): void {
  useDeviceStore.getState().clear();
}

export function hasDeviceCredentials(): boolean {
  return useDeviceStore.getState().hasCredentials;
}
