import { getCredentials } from './credentialStore';
import { executeSystemRemoteCommand } from './deviceRemoteControl';
import { runtimeConfig } from '../config/runtime';

export type RemoteCommandAction =
  | 'PAUSE'
  | 'PLAY'
  | 'TOGGLE_PAUSE'
  | 'RETURN_TO_MENU'
  | 'SELECT_TOUCH_SLOT'
  | 'REBOOT'
  | 'SYNC_NOW'
  | 'CLEAR_SD_CACHE'
  | 'SD_LIST'
  | 'SD_READ'
  | 'SD_WRITE'
  | 'SD_DELETE'
  | 'UPLOAD_LOGS'
  | 'BRIDGE_RECYCLE'
  | 'FORCE_BRIDGE_HEAL'
  | 'CAPTURE_SCREENSHOT';

export interface DeviceRemoteCommand {
  id: string;
  action: RemoteCommandAction;
  slot?: string;
  path?: string;
  content?: string;
  encoding?: 'utf8' | 'base64' | string;
  /** Clear OTA fail cooldown and allow OTA on this sync (ota-retry). */
  forceOta?: boolean;
  /** Skip OTA; media-only sync. */
  skipOta?: boolean;
  /** Clear local credentials before reboot (disable / restore re-pair). */
  forceRePair?: boolean;
  createdAt: string;
}

export type RemoteCommandExecutor = (command: DeviceRemoteCommand) => void | Promise<void>;

let executor: RemoteCommandExecutor | null = null;
let deferredUiCommands: DeviceRemoteCommand[] = [];

async function executeUiCommands(commands: DeviceRemoteCommand[]): Promise<void> {
  const activeExecutor = executor;
  if (!activeExecutor || commands.length === 0) return;
  for (const command of commands) {
    try {
      await activeExecutor(command);
    } catch (error) {
      console.error('[Perform6] Remote command failed', command.action, error);
    }
  }
}

export function registerRemoteCommandExecutor(fn: RemoteCommandExecutor): () => void {
  executor = fn;
  if (deferredUiCommands.length > 0) {
    const queued = deferredUiCommands;
    deferredUiCommands = [];
    console.info('[Perform6] Fast remote commands released to UI', {
      count: queued.length,
      actions: queued.map((command) => command.action),
    });
    void executeUiCommands(queued);
  }
  return () => {
    if (executor === fn) executor = null;
  };
}

export async function processRemoteCommands(commands: DeviceRemoteCommand[]): Promise<void> {
  if (commands.length === 0) return;

  const uiCommands: DeviceRemoteCommand[] = [];
  for (const command of commands) {
    try {
      const handled = await executeSystemRemoteCommand(command);
      if (!handled) uiCommands.push(command);
    } catch (error) {
      console.error('[Perform6] Remote system command failed', command.action, error);
      if (
        command.action === 'SD_LIST' ||
        command.action === 'SD_READ' ||
        command.action === 'SD_WRITE' ||
        command.action === 'SD_DELETE'
      ) {
        const auth = getCredentials();
        if (auth) {
          const { reportSdFsResultSafe } = await import('./sdFsResultApi');
          reportSdFsResultSafe(auth, {
            commandId: command.id,
            action: command.action,
            ok: false,
            path: command.path ?? '',
            error: error instanceof Error ? error.message : 'remote FS failed',
          });
        }
      }
    }
  }

  if (uiCommands.length === 0) return;
  if (!executor) {
    // The fast-command experiment and its pre-mount retention are XT-only.
    // Preserve the established HD226/XC4055 heartbeat behaviour byte-for-byte
    // at the decision boundary until those profiles receive their own tests.
    if (runtimeConfig.hardwareProfile !== 'XT2145') return;
    const knownIds = new Set(deferredUiCommands.map((command) => command.id));
    deferredUiCommands.push(...uiCommands.filter((command) => !knownIds.has(command.id)));
    console.info('[Perform6] Fast remote commands deferred until UI ready', {
      count: uiCommands.length,
      actions: uiCommands.map((command) => command.action),
    });
    return;
  }
  await executeUiCommands(uiCommands);
}
