export type DeviceLogLevel = 'INFO' | 'WARN' | 'ERROR';
export type DeviceLogSource = 'JS' | 'AUTORUN';

export interface BufferedDeviceLog {
  level: DeviceLogLevel;
  source: DeviceLogSource;
  message: string;
  loggedAt: string;
}

const MAX_BUFFER = 1200;
const buffer: BufferedDeviceLog[] = [];
let installed = false;
let urgentFlushHandler: (() => void) | null = null;

function shouldSkipMessage(message: string): boolean {
  if (!message) return true;
  if (message.length > 8000) return false;
  return false;
}

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

  if (shouldSkipMessage(message)) return;

  buffer.push({
    level,
    source: 'JS',
    message: message.slice(0, 8000),
    loggedAt: new Date().toISOString(),
  });
  if (buffer.length > MAX_BUFFER) buffer.shift();

  if (level === 'WARN' || level === 'ERROR') {
    urgentFlushHandler?.();
  }
}

export function setDeviceLogUrgentFlushHandler(handler: (() => void) | null): void {
  urgentFlushHandler = handler;
}

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
  return buffer.splice(0, buffer.length);
}

export function peekDeviceLogCount(): number {
  return buffer.length;
}
