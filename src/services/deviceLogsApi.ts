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

let lastAutorunLine = '';
let flushInFlight = false;

function autorunTailToNewEntries(tail: string): DeviceLogUploadEntry[] {
  if (!tail.trim()) return [];
  const lines = tail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let start = 0;
  if (lastAutorunLine) {
    const idx = lines.lastIndexOf(lastAutorunLine);
    if (idx >= 0) start = idx + 1;
  }

  const fresh = lines.slice(start);
  if (fresh.length === 0) return [];
  lastAutorunLine = fresh[fresh.length - 1] ?? lastAutorunLine;

  return fresh.slice(-200).map((message) => ({
    level:
      message.includes('ERROR') || message.includes('FAILED')
        ? 'ERROR'
        : message.includes('unparsed') || message.includes('ping — no')
          ? 'WARN'
          : 'INFO',
    source: 'AUTORUN' as const,
    message: message.slice(0, 8000),
  }));
}

async function collectLogEntries(): Promise<DeviceLogUploadEntry[]> {
  const jsEntries = drainDeviceLogs().map((entry) => ({
    level: entry.level,
    source: entry.source,
    message: entry.message,
    loggedAt: entry.loggedAt,
  }));

  let autorunEntries: DeviceLogUploadEntry[] = [];
  try {
    const tail = await fetchAutorunLogTail(2_500, { quiet: true });
    autorunEntries = autorunTailToNewEntries(tail);
  } catch (error) {
    console.warn('[Perform6] Autorun log collect failed', error);
  }

  const merged = [...jsEntries, ...autorunEntries];
  if (merged.length > 0) {
    console.info('[Perform6] Log upload batch', {
      js: jsEntries.length,
      autorun: autorunEntries.length,
      total: merged.length,
    });
  }
  return merged.slice(0, 400);
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
    body: JSON.stringify({ entries: entries.slice(0, 400) }),
  });
}

export async function flushDeviceLogs(auth: DeviceAuthContext): Promise<number> {
  if (flushInFlight) return 0;
  flushInFlight = true;
  try {
    const entries = await collectLogEntries();
    if (entries.length === 0) return 0;
    await uploadDeviceLogs(auth, entries);
    return entries.length;
  } finally {
    flushInFlight = false;
  }
}

export async function flushPairingLogs(
  pairingId: string,
  serialNumber: string,
): Promise<number> {
  if (!pairingId.trim() || !serialNumber.trim()) return 0;
  if (flushInFlight) return 0;
  flushInFlight = true;
  try {
    const entries = await collectLogEntries();
    if (entries.length === 0) return 0;

    await apiFetchData<{ accepted: number }>('/devices/pairings/logs', {
      method: 'POST',
      body: JSON.stringify({
        pairingId,
        serialNumber,
        entries: entries.slice(0, 400),
      }),
    });
    return entries.length;
  } finally {
    flushInFlight = false;
  }
}
