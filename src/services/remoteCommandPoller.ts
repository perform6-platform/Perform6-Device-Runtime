import { runtimeConfig } from '../config/runtime';
import type { DeviceRemoteCommand } from './remoteCommandBridge';
import { apiFetchData } from './api';
import { getCredentials } from './credentialStore';
import { processRemoteCommands } from './remoteCommandBridge';

const POLL_MS = 10_000;
let polling = false;

export function startFastRemoteCommandPoller(): () => void {
  // Scope the new behaviour to the actively tested XT profile.
  if (runtimeConfig.hardwareProfile !== 'XT2145' || runtimeConfig.isSimulator) {
    return () => {};
  }
  const tick = async () => {
    if (polling) return;
    const auth = getCredentials();
    if (!auth) return;
    polling = true;
    try {
      const result = await apiFetchData<{ remoteCommands?: DeviceRemoteCommand[] }>(
        '/devices/me/remote-commands',
        {
          method: 'GET',
          token: auth.apiToken,
          deviceId: auth.deviceId,
          timeoutMs: 8_000,
        },
      );
      if (result.remoteCommands?.length) {
        await processRemoteCommands(result.remoteCommands);
      }
    } catch {
      // Heartbeat remains the command-delivery fallback.
    } finally {
      polling = false;
    }
  };
  const id = window.setInterval(() => void tick(), POLL_MS);
  return () => window.clearInterval(id);
}
