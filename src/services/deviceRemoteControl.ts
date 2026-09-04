import { getSharedMessagePort } from '../platform/bsMessagePort';
import { rebootViaBrightSignSystem } from '../platform/brightSignNode';
import { getCredentials } from './credentialStore';
import {
  clearAllSdCachedMarks,
  clearSdMediaCacheViaNode,
  listSdCachedMediaVersionIds,
  requestSdCacheClearAll,
} from './sdCacheBridge';
import { cancelMediaDownloads } from './mediaDownloadGate';
import { clearCachedMediaVersionIds } from './manifest';
import { clearPlaybackManifestCache } from './playbackManifestCache';
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
import { flushDeviceLogs } from './deviceLogsApi';
import { clearLocalDeviceState } from './deviceLocalReset';

const REBOOT_MESSAGE = 'led-ota-reboot';

export interface RemoteSyncNowOptions {
  force?: boolean;
  skipOta?: boolean;
  /** Admin-only: allow OTA install on this sync (default false). */
  forceOta?: boolean;
  /** Allow starting even if another sync/download looks busy (remote recovery). */
  interrupt?: boolean;
  /** When interrupt: cancel OTA (default true). Set false for media-only recovery. */
  cancelOta?: boolean;
  /** When interrupt: cancel media downloads (default true). */
  cancelMedia?: boolean;
}

let runSyncNowHook: ((options?: RemoteSyncNowOptions) => Promise<void>) | null =
  null;

export function registerDeviceRemoteControlHooks(hooks: {
  runSyncNow: (options?: RemoteSyncNowOptions) => Promise<void>;
}): void {
  runSyncNowHook = hooks.runSyncNow;
}

export function requestDeviceReboot(): boolean {
  // Cancel any stuck OTA so reboot is not blocked by a hung transfer.
  cancelOtaInstall();

  // Prefer Node @brightsign/system — works when autorun bridge is dead.
  const nodeOk = rebootViaBrightSignSystem();

  // Also ask autorun (healthy bridge / older packages without Node system).
  const port = getSharedMessagePort();
  let autorunOk = false;
  if (port) {
    try {
      // Admin/remote REBOOT uses led-ota-reboot (not heal marker) so ops
      // can force a reboot even after an earlier failed self-heal attempt.
      port.PostBSMessage({ type: REBOOT_MESSAGE });
      autorunOk = true;
      console.info('[Perform6] Remote reboot requested via autorun');
    } catch (error) {
      console.warn('[Perform6] Autorun reboot PostBSMessage failed', error);
    }
  } else {
    console.warn('[Perform6] Autorun reboot skipped — BSMessagePort missing');
  }

  if (!nodeOk && !autorunOk) {
    console.warn('[Perform6] Remote reboot failed — no Node system and no autorun port');
    return false;
  }
  return true;
}

export async function clearSdCacheRemotely(): Promise<void> {
  // Media only — do not cancel OTA (separate path).
  const mediaVersionIds = listSdCachedMediaVersionIds();
  cancelMediaDownloads();
  // Node wipe first — works when autorun ignores led-cache-clear-all.
  const nodeCleared = clearSdMediaCacheViaNode();
  requestSdCacheClearAll();
  clearAllSdCachedMarks();
  clearCachedMediaVersionIds();
  clearPlaybackManifestCache();
  console.info('[Perform6] Remote SD media cache clear requested', {
    trackedFiles: mediaVersionIds.length,
    nodeCleared,
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
      // Disable/restore must wipe persisted token or reboot reloads the same stuck session.
      if (command.forceRePair === true) {
        console.info('[Perform6] REBOOT forceRePair — clearing local credentials');
        clearLocalDeviceState();
      }
      requestDeviceReboot();
      return true;
    case 'SYNC_NOW':
      if (runSyncNowHook) {
        // OTA only when Admin forceOta / ota-retry. Plain Sync Now = media only.
        const forceOta = command.forceOta === true;
        if (forceOta) {
          clearOtaFailCooldown();
        }
        void runSyncNowHook({
          force: true,
          forceOta,
          skipOta: !forceOta || command.skipOta === true,
          interrupt: true,
          cancelOta: forceOta,
          cancelMedia: true,
        });
      } else {
        console.warn('[Perform6] SYNC_NOW ignored — sync hook not registered');
      }
      return true;
    case 'CLEAR_SD_CACHE':
      await clearSdCacheRemotely();
      if (runSyncNowHook) {
        // Media refill only — leave OTA alone.
        void runSyncNowHook({
          force: true,
          skipOta: true,
          interrupt: true,
          cancelOta: false,
          cancelMedia: true,
        });
      }
      return true;
    case 'SD_LIST':
    case 'SD_READ':
    case 'SD_WRITE':
    case 'SD_DELETE':
      await runSdFsCommand(command);
      return true;
    case 'UPLOAD_LOGS': {
      const auth = getCredentials();
      if (!auth) {
        console.warn('[Perform6] UPLOAD_LOGS skipped — no credentials');
        return true;
      }
      try {
        const n = await flushDeviceLogs(auth);
        console.info('[Perform6] UPLOAD_LOGS flushed', { entries: n });
      } catch (error) {
        console.warn('[Perform6] UPLOAD_LOGS failed', error);
      }
      return true;
    }
    default:
      return false;
  }
}
