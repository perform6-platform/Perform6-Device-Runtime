import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';
import {
  getNodeFs,
  isSafeNodeSdPath,
  rmTreeSync,
  toNodeSdPath,
  type NodeFs,
} from '../platform/brightSignNode';

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

function emptyResult(
  action: string,
  path: string,
  error: string,
  requestId = '',
): SdFsResult {
  return {
    requestId,
    action,
    ok: false,
    path,
    entries: [],
    content: '',
    encoding: 'utf8',
    error,
    sizeBytes: 0,
  };
}

function displaySdPath(nodePath: string): string {
  if (nodePath === '/storage/sd') return 'SD:/';
  if (nodePath.startsWith('/storage/sd/')) {
    return `SD:/${nodePath.slice('/storage/sd/'.length)}`;
  }
  return nodePath;
}

function resolveSafeNodePath(sdPath: string): { nodePath: string; error?: string } {
  const nodePath = toNodeSdPath(sdPath || 'SD:/');
  if (!isSafeNodeSdPath(nodePath)) {
    return { nodePath, error: 'path outside SD:/' };
  }
  return { nodePath };
}

function listViaNode(fs: NodeFs, sdPath: string, requestId: string): SdFsResult {
  const { nodePath, error } = resolveSafeNodePath(sdPath);
  if (error) return emptyResult('SD_LIST', sdPath, error, requestId);
  try {
    if (!fs.existsSync(nodePath)) {
      return emptyResult('SD_LIST', displaySdPath(nodePath), 'not found', requestId);
    }
    const st = fs.statSync(nodePath);
    if (!st.isDirectory()) {
      return emptyResult('SD_LIST', displaySdPath(nodePath), 'not a directory', requestId);
    }
    const names = fs.readdirSync(nodePath) as string[];
    const entries: SdFsEntry[] = [];
    for (const name of names) {
      const child = `${nodePath.replace(/\/$/, '')}/${name}`;
      try {
        const childSt = fs.statSync(child);
        entries.push({
          name,
          size: childSt.isFile() ? childSt.size : 0,
          kind: childSt.isDirectory() ? 'dir' : 'file',
        });
      } catch {
        entries.push({ name, size: 0, kind: 'file' });
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return {
      requestId,
      action: 'SD_LIST',
      ok: true,
      path: displaySdPath(nodePath),
      entries,
      content: '',
      encoding: 'utf8',
      error: '',
      sizeBytes: 0,
    };
  } catch (e) {
    return emptyResult(
      'SD_LIST',
      displaySdPath(nodePath),
      e instanceof Error ? e.message : 'Node list failed',
      requestId,
    );
  }
}

function readViaNode(fs: NodeFs, sdPath: string, requestId: string): SdFsResult {
  const { nodePath, error } = resolveSafeNodePath(sdPath);
  if (error) return emptyResult('SD_READ', sdPath, error, requestId);
  try {
    if (!fs.existsSync(nodePath)) {
      return emptyResult('SD_READ', displaySdPath(nodePath), 'not found', requestId);
    }
    const st = fs.statSync(nodePath);
    if (!st.isFile()) {
      return emptyResult('SD_READ', displaySdPath(nodePath), 'not a file', requestId);
    }
    if (st.size > SD_FS_MAX_CHARS) {
      return emptyResult(
        'SD_READ',
        displaySdPath(nodePath),
        `too large (max ${SD_FS_MAX_CHARS} chars)`,
        requestId,
      );
    }
    const content = String(fs.readFileSync(nodePath, 'utf8'));
    return {
      requestId,
      action: 'SD_READ',
      ok: true,
      path: displaySdPath(nodePath),
      entries: [],
      content,
      encoding: 'utf8',
      error: '',
      sizeBytes: st.size,
    };
  } catch (e) {
    return emptyResult(
      'SD_READ',
      displaySdPath(nodePath),
      e instanceof Error ? e.message : 'Node read failed',
      requestId,
    );
  }
}

function writeViaNode(
  fs: NodeFs,
  sdPath: string,
  content: string,
  requestId: string,
): SdFsResult {
  const { nodePath, error } = resolveSafeNodePath(sdPath);
  if (error) return emptyResult('SD_WRITE', sdPath, error, requestId);
  try {
    const parentIdx = Math.max(nodePath.lastIndexOf('/'), nodePath.lastIndexOf('\\'));
    if (parentIdx > 0) {
      const parent = nodePath.slice(0, parentIdx);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
    }
    fs.writeFileSync(nodePath, content, 'utf8');
    return {
      requestId,
      action: 'SD_WRITE',
      ok: true,
      path: displaySdPath(nodePath),
      entries: [],
      content: '',
      encoding: 'utf8',
      error: '',
      sizeBytes: content.length,
    };
  } catch (e) {
    return emptyResult(
      'SD_WRITE',
      displaySdPath(nodePath),
      e instanceof Error ? e.message : 'Node write failed',
      requestId,
    );
  }
}

function deleteViaNode(fs: NodeFs, sdPath: string, requestId: string): SdFsResult {
  const { nodePath, error } = resolveSafeNodePath(sdPath);
  if (error) return emptyResult('SD_DELETE', sdPath, error, requestId);
  if (nodePath === '/storage/sd') {
    return emptyResult('SD_DELETE', 'SD:/', 'refuse delete SD root', requestId);
  }
  try {
    if (!fs.existsSync(nodePath)) {
      return emptyResult('SD_DELETE', displaySdPath(nodePath), 'not found', requestId);
    }
    const st = fs.statSync(nodePath);
    if (st.isDirectory()) {
      rmTreeSync(fs, nodePath);
    } else {
      fs.unlinkSync(nodePath);
    }
    return {
      requestId,
      action: 'SD_DELETE',
      ok: true,
      path: displaySdPath(nodePath),
      entries: [],
      content: '',
      encoding: 'utf8',
      error: '',
      sizeBytes: 0,
    };
  } catch (e) {
    return emptyResult(
      'SD_DELETE',
      displaySdPath(nodePath),
      e instanceof Error ? e.message : 'Node delete failed',
      requestId,
    );
  }
}

/** Prefer Node fs (bridge-independent); autorun only when Node is unavailable. */
function viaNodeOrAutorun(
  action: SdFsAction,
  sdPath: string,
  autorun: () => Promise<SdFsResult>,
  nodeRun: (fs: NodeFs, requestId: string) => SdFsResult,
): Promise<SdFsResult> {
  const fs = getNodeFs();
  if (fs) {
    const requestId = newRequestId();
    const result = nodeRun(fs, requestId);
    console.info('[Perform6] SD FS via Node', action, {
      path: result.path || sdPath,
      ok: result.ok,
      error: result.error || undefined,
    });
    return Promise.resolve(result);
  }
  return autorun();
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
  return viaNodeOrAutorun(
    'SD_LIST',
    path,
    () => postFsMessage(FS_LIST, { path }, timeoutMs),
    (fs, requestId) => listViaNode(fs, path, requestId),
  );
}

export function readSdPath(path: string, timeoutMs = 25_000): Promise<SdFsResult> {
  return viaNodeOrAutorun(
    'SD_READ',
    path,
    () => postFsMessage(FS_READ, { path }, timeoutMs),
    (fs, requestId) => readViaNode(fs, path, requestId),
  );
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
  return viaNodeOrAutorun(
    'SD_WRITE',
    path,
    () => postFsMessage(FS_WRITE, { path, content, encoding: 'utf8' }, timeoutMs),
    (fs, requestId) => writeViaNode(fs, path, content, requestId),
  );
}

export function deleteSdPath(path: string, timeoutMs = 20_000): Promise<SdFsResult> {
  return viaNodeOrAutorun(
    'SD_DELETE',
    path,
    () => postFsMessage(FS_DELETE, { path }, timeoutMs),
    (fs, requestId) => deleteViaNode(fs, path, requestId),
  );
}
