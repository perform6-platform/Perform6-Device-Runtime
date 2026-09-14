import { getCredentials } from './credentialStore';
import { executeSystemRemoteCommand } from './deviceRemoteControl';

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
  | 'FORCE_BRIDGE_HEAL';

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
const handledCommandIds = new Set<string>();
const handledCommandOrder: string[] = [];
const MAX_HANDLED_COMMAND_IDS = 256;

function claimRemoteCommand(command: DeviceRemoteCommand): boolean {
  const id = command.id.trim();
  if (!id) {
    console.warn('[Perform6] Remote command ignored — missing command id', {
      action: command.action,
    });
    return false;
  }
  if (handledCommandIds.has(id)) {
    console.info('[Perform6] Duplicate remote command ignored', {
      id,
      action: command.action,
    });
    return false;
  }
  handledCommandIds.add(id);
  handledCommandOrder.push(id);
  while (handledCommandOrder.length > MAX_HANDLED_COMMAND_IDS) {
    const expired = handledCommandOrder.shift();
    if (expired) handledCommandIds.delete(expired);
  }
  return true;
}

export function registerRemoteCommandExecutor(fn: RemoteCommandExecutor): () => void {
  executor = fn;
  return () => {
    if (executor === fn) executor = null;
  };
}

export async function processRemoteCommands(commands: DeviceRemoteCommand[]): Promise<void> {
  if (commands.length === 0) return;

  const uiCommands: DeviceRemoteCommand[] = [];
  for (const command of commands) {
    // Heartbeat requests can overlap while a long media download is running.
    // Claim by API command id before async work so a repeated SYNC_NOW cannot
    // interrupt the fetch originally started by that same command.
    if (!claimRemoteCommand(command)) continue;
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

  if (!executor || uiCommands.length === 0) return;
  for (const command of uiCommands) {
    try {
      await executor(command);
    } catch (error) {
      console.error('[Perform6] Remote command failed', command.action, error);
    }
  }
}
