import { useDeviceStore } from '../stores/deviceStore';
import { clearCachedMediaVersionIds } from './manifest';
import { clearAllSdCachedMarks } from './sdCacheBridge';

/** Wipe persisted credentials and local cache marks (re-pair / disable recovery). */
export function clearLocalDeviceState(): void {
  useDeviceStore.getState().clear();
  clearCachedMediaVersionIds();
  clearAllSdCachedMarks();
}
