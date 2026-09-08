/**
 * Bridge-independent native LED playback (XT2145 + XC4055).
 *
 * JS writes SD:/perform6-led-playback.json via Node fs.
 * autorun polls ~500ms and PlayFile(pool path) per target (led / led2 / led3).
 * Legacy dual-write: SD:/perform6-xt-playback.json (XT single-LED shape).
 * Status: SD:/perform6-led-playback-status.json with roles.{led,led2,led3}
 *   (+ per-role sidecars perform6-led-playback-status-<role>.json, xt alias).
 */
import { getNodeFs, toNodeSdPath } from './brightSignNode';

const LED_FILE_SD = 'SD:/perform6-led-playback.json';
const XT_FILE_SD = 'SD:/perform6-xt-playback.json';
const STATUS_SD = 'SD:/perform6-led-playback-status.json';
const STATUS_XT_SD = 'SD:/perform6-xt-playback-status.json';
const BUS_SD = 'SD:/perform6-led-bus.json';
const BUS_XT_SD = 'SD:/perform6-xt-bus.json';
const VOLUME_FLUSH_DELAY_MS = 400;

export type LedPlaybackTarget = 'led' | 'led2' | 'led3';

export interface LedPlaybackCommand {
  target: LedPlaybackTarget;
  src: string;
  fallbackSrc: string;
  mediaVersionId: string;
  mediaTitle: string;
  screenKey: string;
  loop: string;
  paused: string;
  muted: string;
  volumePercent: string;
  restartNonce: string;
  writtenAt: string;
}

export interface LedPlaybackFile {
  type: 'led-playback';
  writtenAt: string;
  commands: LedPlaybackCommand[];
}

export interface LedPlaybackStatus {
  type?: string;
  ok?: string;
  ended?: string;
  detail?: string;
  state?: string;
  src?: string;
  role?: string;
  wantUrl?: string;
  restartNonce?: string;
  /** Per-role map written by autorun 1.5.4+ (read-modify-write). */
  roles?: Partial<Record<LedPlaybackTarget, LedPlaybackStatus>>;
}

export interface LedBusHeartbeat {
  type?: string;
  detail?: string;
  src?: string;
  ts?: string;
}

let lastSig = '';
let pendingFile: LedPlaybackFile | null = null;
let flushTimer: number | null = null;

function signatureOf(file: LedPlaybackFile): string {
  return file.commands
    .map((c) =>
      [
        c.target,
        c.src,
        c.restartNonce,
        c.volumePercent,
        c.loop,
        c.paused,
        c.muted,
        c.writtenAt,
      ].join('|'),
    )
    .join('||');
}

type NodeFsWithRename = {
  renameSync?: (from: string, to: string) => void;
};

function writeAtomic(sdPath: string, body: string): boolean {
  const fs = getNodeFs();
  if (!fs) return false;
  try {
    const finalPath = toNodeSdPath(sdPath);
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, body, 'utf8');
    try {
      const fsAny = fs as NodeFsWithRename;
      if (typeof fsAny.renameSync === 'function') {
        fsAny.renameSync(tmpPath, finalPath);
      } else {
        fs.writeFileSync(finalPath, body, 'utf8');
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      fs.writeFileSync(finalPath, body, 'utf8');
    }
    return true;
  } catch (error) {
    console.warn('[Perform6] LED playback file write failed', sdPath, error);
    return false;
  }
}

function writeFileSync(file: LedPlaybackFile): boolean {
  const body = JSON.stringify(file);
  const ledOk = writeAtomic(LED_FILE_SD, body);
  // Legacy XT single-command shape for older autorun / diagnostics.
  const ledCmd = file.commands.find((c) => c.target === 'led');
  if (ledCmd) {
    const legacy = {
      type: 'xt-playback',
      role: 'touch',
      src: ledCmd.src,
      fallbackSrc: ledCmd.fallbackSrc,
      mediaVersionId: ledCmd.mediaVersionId,
      mediaTitle: ledCmd.mediaTitle,
      screenKey: ledCmd.screenKey,
      loop: ledCmd.loop,
      paused: ledCmd.paused,
      muted: ledCmd.muted,
      volumePercent: ledCmd.volumePercent,
      restartNonce: ledCmd.restartNonce,
      writtenAt: ledCmd.writtenAt,
    };
    writeAtomic(XT_FILE_SD, JSON.stringify(legacy));
  }
  if (ledOk) {
    lastSig = signatureOf(file);
    console.info('[Perform6] led-playback file written (SD bus — bridge optional)', {
      targets: file.commands.map((c) => c.target),
      srcs: file.commands.map((c) => c.src),
    });
  }
  return ledOk;
}

function flushPending(): void {
  flushTimer = null;
  const file = pendingFile;
  pendingFile = null;
  if (!file) return;
  if (signatureOf(file) === lastSig) return;
  writeFileSync(file);
}

export function toLedPlaybackCommand(
  partial: Omit<LedPlaybackCommand, 'writtenAt'> & { writtenAt?: string },
): LedPlaybackCommand | null {
  if (!partial.src || !partial.target) return null;
  return {
    target: partial.target,
    src: partial.src,
    fallbackSrc: partial.fallbackSrc ?? '',
    mediaVersionId: partial.mediaVersionId ?? '',
    mediaTitle: partial.mediaTitle ?? '',
    screenKey: partial.screenKey ?? 'SCREEN_1',
    loop: partial.loop ?? 'true',
    paused: partial.paused ?? 'false',
    muted: partial.muted ?? 'false',
    volumePercent: partial.volumePercent ?? '100',
    restartNonce: partial.restartNonce ?? '0',
    writtenAt: partial.writtenAt ?? String(Date.now()),
  };
}

/**
 * Persist one or more LED commands. Play/src/nonce = immediate write.
 */
export function writeLedPlaybackFile(
  commands: Array<Omit<LedPlaybackCommand, 'writtenAt'> & { writtenAt?: string }>,
  options?: { immediate?: boolean; force?: boolean },
): boolean {
  const now = String(Date.now());
  const cmds: LedPlaybackCommand[] = [];
  for (const partial of commands) {
    const cmd = toLedPlaybackCommand({
      ...partial,
      writtenAt: options?.force ? now : (partial.writtenAt ?? now),
    });
    if (cmd) cmds.push(cmd);
  }
  if (cmds.length === 0) return false;

  const file: LedPlaybackFile = {
    type: 'led-playback',
    writtenAt: now,
    commands: cmds,
  };

  const immediate = options?.immediate !== false;
  if (immediate) {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingFile = null;
    return writeFileSync(file);
  }

  pendingFile = file;
  if (flushTimer != null) return true;
  flushTimer = window.setTimeout(flushPending, VOLUME_FLUSH_DELAY_MS);
  return true;
}

function readJsonFile(sdPath: string): Record<string, unknown> | null {
  const fs = getNodeFs();
  if (!fs) return null;
  try {
    const path = toNodeSdPath(sdPath);
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, 'utf8');
    const text = typeof raw === 'string' ? raw : String(raw);
    if (!text.trim()) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asStatus(raw: Record<string, unknown> | null): LedPlaybackStatus | null {
  if (!raw) return null;
  return raw as LedPlaybackStatus;
}

function statusRolePath(role: LedPlaybackTarget): string {
  return `SD:/perform6-led-playback-status-${role}.json`;
}

/**
 * Full status document (may include roles map). Prefer readLedPlaybackStatusForRole.
 */
export function readLedPlaybackStatus(): LedPlaybackStatus | null {
  return (
    asStatus(readJsonFile(STATUS_SD)) ?? asStatus(readJsonFile(STATUS_XT_SD))
  );
}

/**
 * Status for one LED role — roles map, then per-role sidecar, then flat if role matches.
 */
export function readLedPlaybackStatusForRole(
  role: LedPlaybackTarget,
): LedPlaybackStatus | null {
  const doc = readLedPlaybackStatus();
  const fromRoles = doc?.roles?.[role];
  if (fromRoles && typeof fromRoles === 'object') {
    return { ...fromRoles, type: doc?.type ?? fromRoles.type, role };
  }

  const sidecar = asStatus(readJsonFile(statusRolePath(role)));
  if (sidecar) {
    return { ...sidecar, role: sidecar.role ?? role };
  }

  if (doc?.role === role) return doc;
  return null;
}

export function readLedBusHeartbeat(): LedBusHeartbeat | null {
  return (
    (readJsonFile(BUS_SD) as LedBusHeartbeat | null) ??
    (readJsonFile(BUS_XT_SD) as LedBusHeartbeat | null)
  );
}

export function isLedStatusStarted(status: LedPlaybackStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.ok !== '1') return false;
  const state = status.state ?? '';
  if (state === 'started' || state === 'started-transport' || state === '') return true;
  const detail = status.detail ?? '';
  return detail.startsWith('file-play-') && !detail.includes('pending');
}

/** @deprecated Prefer writeLedPlaybackFile / readLed* — kept for XT bridge imports. */
export type XtPlaybackRecord = LedPlaybackCommand & {
  type: 'xt-playback';
  role: 'touch';
};
export type XtPlaybackStatus = LedPlaybackStatus;
export type XtBusHeartbeat = LedBusHeartbeat;

export function writeXtPlaybackFile(
  record: Omit<LedPlaybackCommand, 'writtenAt' | 'target'> & {
    type?: string;
    role?: string;
    target?: LedPlaybackTarget;
    writtenAt?: string;
  },
  options?: { immediate?: boolean; force?: boolean },
): boolean {
  return writeLedPlaybackFile(
    [
      {
        target: 'led',
        src: record.src,
        fallbackSrc: record.fallbackSrc ?? '',
        mediaVersionId: record.mediaVersionId ?? '',
        mediaTitle: record.mediaTitle ?? '',
        screenKey: record.screenKey ?? 'SCREEN_1',
        loop: record.loop ?? 'true',
        paused: record.paused ?? 'false',
        muted: record.muted ?? 'false',
        volumePercent: record.volumePercent ?? '100',
        restartNonce: record.restartNonce ?? '0',
      },
    ],
    options,
  );
}

export function readXtPlaybackStatus(): LedPlaybackStatus | null {
  return readLedPlaybackStatusForRole('led');
}

export function readXtBusHeartbeat(): LedBusHeartbeat | null {
  return readLedBusHeartbeat();
}

