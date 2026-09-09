import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import { drainDeviceLogs, type BufferedDeviceLog } from './deviceLogCollector';
import { fetchAutorunLogTail } from './ledLogBridge';
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import { runtimeConfig } from '../config/runtime';
import { useRuntimeStore } from '../stores/runtimeStore';

export interface DeviceLogUploadEntry {
  level: BufferedDeviceLog['level'];
  source: BufferedDeviceLog['source'];
  message: string;
  loggedAt?: string;
}

let lastAutorunLine = '';
let flushInFlight = false;
const lastCanaryValue = new Map<string, string>();

const CANARY_FILES = [
  'SD:/perform6-boot-canary.txt',
  'SD:/perform6-heartbeat.txt',
  'SD:/perform6-playfile-attempt.txt',
] as const;

function readCanaryEntries(): DeviceLogUploadEntry[] {
  const fs = getNodeFs();
  if (!fs) return [];
  const now = new Date().toISOString();
  const out: DeviceLogUploadEntry[] = [];
  for (const sd of CANARY_FILES) {
    try {
      const nodePath = toNodeSdPath(sd);
      if (!fs.existsSync(nodePath)) {
        const value = '<missing>';
        if (lastCanaryValue.get(sd) === value) continue;
        lastCanaryValue.set(sd, value);
        out.push({
          level: 'WARN',
          source: 'AUTORUN',
          message: `CANARY|missing|${sd}`,
          loggedAt: now,
        });
        continue;
      }
      const raw = fs.readFileSync(nodePath, 'utf8');
      const text = (typeof raw === 'string' ? raw : String(raw)).trim().slice(0, 2000);
      const value = text || '(empty)';
      if (lastCanaryValue.get(sd) === value) continue;
      lastCanaryValue.set(sd, value);
      out.push({
        level: 'INFO',
        source: 'AUTORUN',
        message: `CANARY|${sd}|${value}`,
        loggedAt: now,
      });
    } catch {
      const value = '<read-fail>';
      if (lastCanaryValue.get(sd) === value) continue;
      lastCanaryValue.set(sd, value);
      out.push({
        level: 'WARN',
        source: 'AUTORUN',
        message: `CANARY|read-fail|${sd}`,
        loggedAt: now,
      });
    }
  }
  return out;
}

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

  return fresh.slice(-250).map((message) => ({
    level:
      message.includes('ERROR') || message.includes('FAILED') || message.includes('FN|break')
        ? 'ERROR'
        : message.includes('unparsed') || message.includes('ping — no') || message.includes('CANARY|missing')
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

  const canaryEntries = readCanaryEntries();

  const merged = [...jsEntries, ...autorunEntries, ...canaryEntries];
  return merged.slice(0, 500);
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

async function mirrorDiagnostics(
  entries: DeviceLogUploadEntry[],
  serialOverride?: string,
): Promise<void> {
  const base = runtimeConfig.diagnosticsBaseUrl.replace(/\/+$/, '');
  const key = runtimeConfig.diagnosticsIngestKey;
  if (!base || !key || entries.length === 0) return;
  const info = useRuntimeStore.getState().deviceInfo;
  const serialNumber = serialOverride?.trim() || info?.serialNumber?.trim();
  if (!serialNumber) return;

  try {
    const response = await fetch(`${base}/diagnostics/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Diagnostics-Key': key,
      },
      body: JSON.stringify({
        serialNumber,
        model: info?.model ?? runtimeConfig.hardwareProfile,
        firmwareVersion: info?.firmwareVersion,
        runtimeVersion: runtimeConfig.runtimeVersion,
        entries: entries.slice(0, 400),
      }),
    });
    if (!response.ok) {
      console.warn('[Perform6] Atlas diagnostic mirror rejected', response.status);
    }
  } catch (error) {
    // The mirror is observability-only: never disturb production sync/playback.
    console.warn('[Perform6] Atlas diagnostic mirror unavailable', error);
  }
}

export async function flushDeviceLogs(auth: DeviceAuthContext): Promise<number> {
  if (flushInFlight) return 0;
  flushInFlight = true;
  try {
    const entries = await collectLogEntries();
    if (entries.length === 0) return 0;
    await uploadDeviceLogs(auth, entries);
    await mirrorDiagnostics(entries);
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
    await mirrorDiagnostics(entries, serialNumber);
    return entries.length;
  } finally {
    flushInFlight = false;
  }
}
