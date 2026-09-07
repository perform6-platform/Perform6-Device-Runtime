/**
 * Bridge-independent LED playback (XT2145).
 *
 * JS writes SD:/perform6-xt-playback.json via Node fs.
 * autorun polls every 500ms and calls roVideoPlayer.PlayFile.
 * Status: SD:/perform6-xt-playback-status.json (autorun → JS via Node read).
 */
import { getNodeFs, toNodeSdPath } from './brightSignNode';

const FILE_SD_PATH = 'SD:/perform6-xt-playback.json';
const STATUS_SD_PATH = 'SD:/perform6-xt-playback-status.json';
const VOLUME_FLUSH_DELAY_MS = 400;

export interface XtPlaybackRecord {
  type: 'xt-playback';
  role: 'touch';
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

export interface XtPlaybackStatus {
  type?: string;
  ok?: string;
  ended?: string;
  detail?: string;
  /** accepted | started | pending | error | ended */
  state?: string;
  src?: string;
  restartNonce?: string;
}

let lastSig = '';
let pendingRecord: XtPlaybackRecord | null = null;
let flushTimer: number | null = null;

function signatureOf(rec: XtPlaybackRecord): string {
  return [
    rec.src,
    rec.restartNonce,
    rec.volumePercent,
    rec.loop,
    rec.paused,
    rec.muted,
    rec.writtenAt,
  ].join('|');
}

function writeRecordSync(rec: XtPlaybackRecord): boolean {
  const fs = getNodeFs();
  if (!fs) return false;
  try {
    fs.writeFileSync(toNodeSdPath(FILE_SD_PATH), JSON.stringify(rec), 'utf8');
    lastSig = signatureOf(rec);
    console.info('[Perform6] xt-playback file written (SD bus — bridge optional)', {
      nonce: rec.restartNonce,
      src: rec.src,
    });
    return true;
  } catch (error) {
    console.warn('[Perform6] xt-playback file write failed', error);
    return false;
  }
}

function flushPending(): void {
  flushTimer = null;
  const rec = pendingRecord;
  pendingRecord = null;
  if (!rec) return;
  if (signatureOf(rec) === lastSig) return;
  writeRecordSync(rec);
}

function toRecord(
  record: Omit<XtPlaybackRecord, 'type' | 'role' | 'writtenAt'> & {
    type?: string;
    role?: string;
  },
): XtPlaybackRecord | null {
  if (!record.src) return null;
  return {
    type: 'xt-playback',
    role: 'touch',
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
    writtenAt: String(Date.now()),
  };
}

/**
 * Persist playback intent to SD. Play/src/nonce = immediate write.
 * Volume-only tweaks stay debounced.
 */
export function writeXtPlaybackFile(
  record: Omit<XtPlaybackRecord, 'type' | 'role' | 'writtenAt'> & {
    type?: string;
    role?: string;
  },
  options?: { immediate?: boolean },
): boolean {
  const rec = toRecord(record);
  if (!rec) return false;

  const immediate = options?.immediate !== false;
  if (immediate) {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingRecord = null;
    return writeRecordSync(rec);
  }

  pendingRecord = rec;
  if (flushTimer != null) return true;
  flushTimer = window.setTimeout(flushPending, VOLUME_FLUSH_DELAY_MS);
  return true;
}

export function readXtPlaybackStatus(): XtPlaybackStatus | null {
  const fs = getNodeFs();
  if (!fs) return null;
  try {
    const path = toNodeSdPath(STATUS_SD_PATH);
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, 'utf8');
    const text = typeof raw === 'string' ? raw : String(raw);
    if (!text.trim()) return null;
    return JSON.parse(text) as XtPlaybackStatus;
  } catch {
    return null;
  }
}
