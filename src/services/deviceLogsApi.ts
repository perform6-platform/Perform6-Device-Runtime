import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import { drainDeviceLogs, type BufferedDeviceLog } from './deviceLogCollector';
import { fetchAutorunLogTail } from './ledLogBridge';

export interface DeviceLogUploadEntry {
  level: BufferedDeviceLog['level'];
  source: BufferedDeviceLog['source'];
  message: string;
  loggedAt?: string;
}

function autorunTailToEntries(tail: string): DeviceLogUploadEntry[] {
  if (!tail.trim()) return [];
  return tail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-120)
    .map((message) => ({
      level: message.includes('ERROR') || message.includes('FAILED') ? 'ERROR' : 'INFO',
      source: 'AUTORUN' as const,
      message: message.slice(0, 8000),
    }));
}

export async function uploadDeviceLogs(
  auth: DeviceAuthContext,
  entries: DeviceLogUploadEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await apiFetchData<{ accepted: number }>('/devices/me/logs', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify({ entries: entries.slice(0, 200) }),
  });
}

/** Flush JS console buffer + autorun log tail to the API. */
export async function flushDeviceLogs(auth: DeviceAuthContext): Promise<number> {
  const jsEntries = drainDeviceLogs().map((entry) => ({
    level: entry.level,
    source: entry.source,
    message: entry.message,
    loggedAt: entry.loggedAt,
  }));

  let autorunEntries: DeviceLogUploadEntry[] = [];
  try {
    const tail = await fetchAutorunLogTail();
    autorunEntries = autorunTailToEntries(tail);
  } catch {
    /* best-effort */
  }

  const entries = [...jsEntries, ...autorunEntries].slice(0, 200);
  if (entries.length === 0) return 0;

  await uploadDeviceLogs(auth, entries);
  return entries.length;
}
