export type DeviceLogLevel = 'INFO' | 'WARN' | 'ERROR';
export type DeviceLogSource = 'JS' | 'AUTORUN';

export interface BufferedDeviceLog {
  level: DeviceLogLevel;
  source: DeviceLogSource;
  message: string;
  loggedAt: string;
}

const MAX_BUFFER = 400;
const buffer: BufferedDeviceLog[] = [];
let installed = false;

function pushLog(level: DeviceLogLevel, args: unknown[]): void {
  const message = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ')
    .trim();

  if (!message.includes('[Perform6]')) return;

  buffer.push({
    level,
    source: 'JS',
    message: message.slice(0, 8000),
    loggedAt: new Date().toISOString(),
  });
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

/** Capture `[Perform6]` console lines for remote upload. */
export function installDeviceLogCollector(): void {
  if (installed || typeof console === 'undefined') return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    pushLog('INFO', args);
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    pushLog('INFO', args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    pushLog('WARN', args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    pushLog('ERROR', args);
  };
}

export function drainDeviceLogs(): BufferedDeviceLog[] {
  if (buffer.length === 0) return [];
  const copy = buffer.splice(0, buffer.length);
  return copy;
}

export function peekDeviceLogCount(): number {
  return buffer.length;
}
