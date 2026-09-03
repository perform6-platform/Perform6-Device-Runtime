import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';

const FS_LIST = 'led-fs-list';
const FS_READ = 'led-fs-read';
const FS_WRITE = 'led-fs-write';
const FS_DELETE = 'led-fs-delete';
const FS_RESULT = 'led-fs-result';

/** Keep in sync with autorun WriteAsciiFile limit — big files use OTA. */
export const SD_FS_MAX_CHARS = 32_000;

export type SdFsAction = 'SD_LIST' | 'SD_READ' | 'SD_WRITE' | 'SD_DELETE';

export interface SdFsEntry {
  name: string;
  size: number;
  kind: 'file' | 'dir';
}

export interface SdFsResult {
  requestId: string;
  action: SdFsAction | string;
  ok: boolean;
  path: string;
  entries: SdFsEntry[];
  content: string;
  encoding: 'utf8' | 'base64' | string;
  error: string;
  sizeBytes: number;
}

function newRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseEntries(raw: string): SdFsEntry[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', sizeRaw = '0', kindRaw = 'file'] = line.split('|');
      const size = Number.parseInt(sizeRaw, 10);
      const kind = kindRaw === 'dir' ? 'dir' : 'file';
      return {
        name,
        size: Number.isFinite(size) ? size : 0,
        kind,
      };
    });
}

function waitForFsResult(requestId: string, timeoutMs: number): Promise<SdFsResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SdFsResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(result);
    };

    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== FS_RESULT) return;
      if (String(data.requestId ?? '') !== requestId) return;
      finish({
        requestId,
        action: String(data.action ?? ''),
        ok: String(data.ok ?? '') === '1' || data.ok === true,
        path: String(data.path ?? ''),
        entries: parseEntries(String(data.entries ?? '')),
        content: String(data.content ?? ''),
        encoding: String(data.encoding ?? 'utf8'),
        error: String(data.error ?? ''),
        sizeBytes: Number(data.sizeBytes ?? 0) || 0,
      });
    });

    const timer = window.setTimeout(() => {
      finish({
        requestId,
        action: '',
        ok: false,
        path: '',
        entries: [],
        content: '',
        encoding: 'utf8',
        error: 'autorun FS timeout',
        sizeBytes: 0,
      });
    }, timeoutMs);
  });
}

async function postFsMessage(
  type: string,
  fields: Record<string, string>,
  timeoutMs = 20_000,
): Promise<SdFsResult> {
  const port = getSharedMessagePort();
  if (!port) {
    return {
      requestId: '',
      action: '',
      ok: false,
      path: fields.path ?? '',
      entries: [],
      content: '',
      encoding: 'utf8',
      error: 'BSMessagePort missing',
      sizeBytes: 0,
    };
  }

  const requestId = newRequestId();
  const pending = waitForFsResult(requestId, timeoutMs);
  try {
    port.PostBSMessage({ type, requestId, ...fields });
  } catch (error) {
    return {
      requestId,
      action: '',
      ok: false,
      path: fields.path ?? '',
      entries: [],
      content: '',
      encoding: 'utf8',
      error: error instanceof Error ? error.message : 'PostBSMessage failed',
      sizeBytes: 0,
    };
  }
  return pending;
}

export function listSdPath(path = 'SD:/', timeoutMs = 20_000): Promise<SdFsResult> {
  return postFsMessage(FS_LIST, { path }, timeoutMs);
}

export function readSdPath(path: string, timeoutMs = 25_000): Promise<SdFsResult> {
  return postFsMessage(FS_READ, { path }, timeoutMs);
}

export function writeSdPath(
  path: string,
  content: string,
  encoding: 'utf8' | 'base64' = 'utf8',
  timeoutMs = 25_000,
): Promise<SdFsResult> {
  if (encoding === 'base64') {
    return Promise.resolve({
      requestId: '',
      action: 'SD_WRITE',
      ok: false,
      path,
      entries: [],
      content: '',
      encoding,
      error: 'base64 write removed — text only (use OTA for binary)',
      sizeBytes: 0,
    });
  }
  if (content.length > SD_FS_MAX_CHARS) {
    return Promise.resolve({
      requestId: '',
      action: 'SD_WRITE',
      ok: false,
      path,
      entries: [],
      content: '',
      encoding: 'utf8',
      error: `too large (max ${SD_FS_MAX_CHARS} chars) — use OTA for big files`,
      sizeBytes: 0,
    });
  }
  return postFsMessage(FS_WRITE, { path, content, encoding: 'utf8' }, timeoutMs);
}

export function deleteSdPath(path: string, timeoutMs = 20_000): Promise<SdFsResult> {
  return postFsMessage(FS_DELETE, { path }, timeoutMs);
}
