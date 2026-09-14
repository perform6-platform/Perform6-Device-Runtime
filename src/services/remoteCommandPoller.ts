import { runtimeConfig } from '../config/runtime';
import type { DeviceRemoteCommand } from './remoteCommandBridge';
import { apiFetchData } from './api';
import { getCredentials } from './credentialStore';
import { processRemoteCommands } from './remoteCommandBridge';

const POLL_MS = 10_000;
const FIRST_POLL_DELAY_MS = 500;
let polling = false;
let consecutiveFailures = 0;

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
        console.info('[Perform6] Fast remote commands received', {
          count: result.remoteCommands.length,
          actions: result.remoteCommands.map((command) => command.action),
        });
        await processRemoteCommands(result.remoteCommands);
      }
      if (consecutiveFailures > 0) {
        console.info('[Perform6] Fast remote command poll recovered', {
          failures: consecutiveFailures,
        });
      }
      consecutiveFailures = 0;
    } catch (error) {
      // Heartbeat remains the command-delivery fallback.
      consecutiveFailures += 1;
      if (consecutiveFailures === 1 || consecutiveFailures % 6 === 0) {
        console.warn('[Perform6] Fast remote command poll failed; heartbeat fallback remains active', {
          failures: consecutiveFailures,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      polling = false;
    }
  };
  console.info('[Perform6] Fast remote command poller armed', {
    intervalMs: POLL_MS,
    firstPollDelayMs: FIRST_POLL_DELAY_MS,
  });
  const first = window.setTimeout(() => void tick(), FIRST_POLL_DELAY_MS);
  const id = window.setInterval(() => void tick(), POLL_MS);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(id);
  };
}
