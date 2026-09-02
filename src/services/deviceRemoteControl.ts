import { getSharedMessagePort } from '../platform/bsMessagePort';
import { clearLocalDeviceState } from './deviceLocalReset';
import { clearCachedMediaVersionIds } from './manifest';
import {
  clearAllSdCachedMarks,
  listSdCachedMediaVersionIds,
  requestSdCacheClearAll,
} from './sdCacheBridge';
import type { DeviceRemoteCommand } from './remoteCommandBridge';

const REBOOT_MESSAGE = 'led-ota-reboot';

let runSyncNowHook: (() => Promise<void>) | null = null;

export function registerDeviceRemoteControlHooks(hooks: {
  runSyncNow: () => Promise<void>;
}): void {
  runSyncNowHook = hooks.runSyncNow;
}

export function requestDeviceReboot(): boolean {
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Remote reboot skipped — BSMessagePort missing');
    return false;
  }
  port.PostBSMessage({ type: REBOOT_MESSAGE });
  console.info('[Perform6] Remote reboot requested');
  return true;
}

export async function clearSdCacheRemotely(): Promise<void> {
  const mediaVersionIds = listSdCachedMediaVersionIds();
  requestSdCacheClearAll();
  clearAllSdCachedMarks();
  clearCachedMediaVersionIds();
  console.info('[Perform6] Remote SD cache clear requested', {
    trackedFiles: mediaVersionIds.length,
  });
}

export async function executeSystemRemoteCommand(
  command: DeviceRemoteCommand,
): Promise<boolean> {
  switch (command.action) {
    case 'REBOOT':
      clearLocalDeviceState();
      requestDeviceReboot();
      return true;
    case 'SYNC_NOW':
      if (runSyncNowHook) {
        void runSyncNowHook();
      } else {
        console.warn('[Perform6] SYNC_NOW ignored — sync hook not registered');
      }
      return true;
    case 'CLEAR_SD_CACHE':
      await clearSdCacheRemotely();
      if (runSyncNowHook) {
        void runSyncNowHook();
      }
      return true;
    default:
      return false;
  }
}
