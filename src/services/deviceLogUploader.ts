import { getCredentials } from './credentialStore';
import {
  peekDeviceLogCount,
  setDeviceLogUrgentFlushHandler,
} from './deviceLogCollector';
import { flushDeviceLogs, flushPairingLogs } from './deviceLogsApi';
import { useDeviceStore } from '../stores/deviceStore';
import { useRuntimeStore } from '../stores/runtimeStore';

const FLUSH_INTERVAL_MS = 5_000;
const URGENT_DEBOUNCE_MS = 400;

let started = false;
let intervalId: number | null = null;
let urgentTimer: number | null = null;

function pairingContext(): { pairingId: string; serialNumber: string } | null {
  const pairingId = useDeviceStore.getState().pairingId?.trim();
  const serial =
    useRuntimeStore.getState().deviceInfo?.serialNumber?.trim() ?? '';
  if (!pairingId || !serial) return null;
  return { pairingId, serialNumber: serial };
}

async function flushNow(): Promise<void> {
  const auth = getCredentials();
  if (auth) {
    await flushDeviceLogs(auth);
    return;
  }
  const pairing = pairingContext();
  if (pairing) {
    await flushPairingLogs(pairing.pairingId, pairing.serialNumber);
  }
}

function scheduleUrgentFlush(): void {
  if (urgentTimer != null) return;
  urgentTimer = window.setTimeout(() => {
    urgentTimer = null;
    void flushNow().catch(() => undefined);
  }, URGENT_DEBOUNCE_MS);
}

export function startDeviceLogUploader(): void {
  if (started) return;
  started = true;

  setDeviceLogUrgentFlushHandler(scheduleUrgentFlush);

  intervalId = window.setInterval(() => {
    if (!getCredentials() && !pairingContext()) return;
    void flushNow().catch(() => undefined);
  }, FLUSH_INTERVAL_MS);

  console.info('[Perform6] Device log uploader started', {
    intervalMs: FLUSH_INTERVAL_MS,
  });
}

export function stopDeviceLogUploader(): void {
  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  if (urgentTimer != null) {
    window.clearTimeout(urgentTimer);
    urgentTimer = null;
  }
  setDeviceLogUrgentFlushHandler(null);
  started = false;
}

export function requestDeviceLogFlushSoon(): void {
  if (peekDeviceLogCount() > 0) scheduleUrgentFlush();
}
