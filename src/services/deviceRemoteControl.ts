import { getSharedMessagePort } from '../platform/bsMessagePort';
import {
  clearAllSdCachedMarks,
  listSdCachedMediaVersionIds,
  requestSdCacheClearAll,
} from './sdCacheBridge';
import { clearCachedMediaVersionIds } from './manifest';
import {
  cancelOtaInstall,
} from './otaApply';
import type { DeviceRemoteCommand } from './remoteCommandBridge';

const REBOOT_MESSAGE = 'led-ota-reboot';

export interface RemoteSyncNowOptions {
  force?: boolean;
  skipOta?: boolean;
  /** Allow starting even if another sync/download looks busy (remote recovery). */
  interrupt?: boolean;
}

let runSyncNowHook: ((options?: RemoteSyncNowOptions) => Promise<void>) | null =
  null;

export function registerDeviceRemoteControlHooks(hooks: {
  runSyncNow: (options?: RemoteSyncNowOptions) => Promise<void>;
}): void {
  runSyncNowHook = hooks.runSyncNow;
}

export function requestDeviceReboot(): boolean {
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Remote reboot skipped — BSMessagePort missing');
    return false;
  }
  // Cancel any stuck OTA so reboot is not blocked by a hung transfer.
  cancelOtaInstall();
  port.PostBSMessage({ type: REBOOT_MESSAGE });
  console.info('[Perform6] Remote reboot requested');
  return true;
}

export async function clearSdCacheRemotely(): Promise<void> {
  cancelOtaInstall();
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
      // Do NOT wipe credentials here — if reboot fails, heartbeat/remote must keep working.
      requestDeviceReboot();
      return true;
    case 'SYNC_NOW':
      if (runSyncNowHook) {
        void runSyncNowHook({
          force: true,
          skipOta: true,
          interrupt: true,
        });
      } else {
        console.warn('[Perform6] SYNC_NOW ignored — sync hook not registered');
      }
      return true;
    case 'CLEAR_SD_CACHE':
      await clearSdCacheRemotely();
      if (runSyncNowHook) {
        void runSyncNowHook({
          force: true,
          skipOta: true,
          interrupt: true,
        });
      }
      return true;
    default:
      return false;
  }
}
