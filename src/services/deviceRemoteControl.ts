import { getSharedMessagePort } from '../platform/bsMessagePort';
import { getCredentials } from './credentialStore';
import {
  clearAllSdCachedMarks,
  listSdCachedMediaVersionIds,
  requestSdCacheClearAll,
} from './sdCacheBridge';
import { clearCachedMediaVersionIds } from './manifest';
import {
  cancelOtaInstall,
  clearOtaFailCooldown,
} from './otaApply';
import type { DeviceRemoteCommand } from './remoteCommandBridge';
import {
  deleteSdPath,
  listSdPath,
  readSdPath,
  writeSdPath,
  type SdFsResult,
} from './sdFsBridge';
import { reportSdFsResultSafe } from './sdFsResultApi';

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

function publishFsResult(command: DeviceRemoteCommand, result: SdFsResult): void {
  const auth = getCredentials();
  if (!auth) {
    console.warn('[Perform6] SD FS result not reported — no credentials');
    return;
  }
  reportSdFsResultSafe(auth, {
    commandId: command.id,
    action: command.action,
    ok: result.ok,
    path: result.path || command.path || '',
    entries: result.entries,
    content: result.content,
    encoding: result.encoding,
    error: result.error || undefined,
    sizeBytes: result.sizeBytes,
  });
}

async function runSdFsCommand(command: DeviceRemoteCommand): Promise<void> {
  const path = (command.path ?? 'SD:/').trim() || 'SD:/';
  let result: SdFsResult;
  switch (command.action) {
    case 'SD_LIST':
      result = await listSdPath(path);
      break;
    case 'SD_READ':
      result = await readSdPath(path);
      break;
    case 'SD_WRITE': {
      const encoding = command.encoding === 'base64' ? 'base64' : 'utf8';
      const content = command.content ?? '';
      result = await writeSdPath(path, content, encoding);
      break;
    }
    case 'SD_DELETE':
      result = await deleteSdPath(path);
      break;
    default:
      return;
  }
  console.info('[Perform6] Remote SD FS', command.action, {
    ok: result.ok,
    path: result.path || path,
    error: result.error || undefined,
    entries: result.entries?.length,
  });
  publishFsResult(command, result);
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
        cancelOtaInstall();
        // Plain Sync Now must NOT clear OTA fail cooldown — that lets media recover.
        // Only ota-retry passes forceOta to unlock OTA again.
        if (command.forceOta) {
          clearOtaFailCooldown();
        }
        void runSyncNowHook({
          force: true,
          skipOta: command.skipOta === true,
          interrupt: true,
        });
      } else {
        console.warn('[Perform6] SYNC_NOW ignored — sync hook not registered');
      }
      return true;
    case 'CLEAR_SD_CACHE':
      await clearSdCacheRemotely();
      if (runSyncNowHook) {
        cancelOtaInstall();
        // Prefer media refill after cache clear; OTA retry stays on ota-retry / cooldown end.
        void runSyncNowHook({
          force: true,
          skipOta: true,
          interrupt: true,
        });
      }
      return true;
    case 'SD_LIST':
    case 'SD_READ':
    case 'SD_WRITE':
    case 'SD_DELETE':
      await runSdFsCommand(command);
      return true;
    default:
      return false;
  }
}
