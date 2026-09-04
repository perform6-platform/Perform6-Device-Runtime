/**
 * BrightSign asset-pool OTA delivery (separate from media).
 * Pool: sd/perform6-ota-pool (BrightSign AssetPool path) — never cleared by media clear-cache.
 * After fetch, files are copied to SD:/{path} (autorun.brs, index.html, assets/…).
 */
import type { DeviceAuthContext } from '../shared/types/api';
import { OTA_ASSET_POOL_DIR, OTA_ASSET_POOL_DIR_DOCS } from './brightSignPoolPath';
import { probeBrightSignAssetPool } from './assetPoolProbe';
import type { OtaManifestFile, OtaManifestResponse } from './otaApply';
import { runtimeConfig } from '../config/runtime';
import { reportOtaStatusSafe } from './otaStatusApi';

/** Docs-style pool root (sd/perform6-ota-pool). Realize still copies to SD:/{path}. */
export const OTA_POOL_PATH = OTA_ASSET_POOL_DIR;

type BrightSignRequire = (id: string) => unknown;

type AssetHash = { method: string; hex: string };

type OtaAsset = {
  name: string;
  link: string;
  size?: number;
  hash?: AssetHash;
  changehint?: string;
  changeHint?: string;
};

type AssetPoolInstance = {
  protectAssets: (name: string, list: OtaAsset[]) => Promise<void> | void;
};

type ProgressEvent = {
  filename?: string;
  currentFileTransferred?: number;
  currentFileTotal?: number;
};

type FileEvent = {
  filename?: string;
  responseCode?: number;
  error?: string;
};

type AssetPoolFetcherInstance = {
  start: (list: OtaAsset[], params?: Record<string, unknown>) => Promise<void>;
  cancel: () => Promise<void>;
  addEventListener: (
    type: string,
    handler: (event: ProgressEvent | FileEvent) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    handler: (event: ProgressEvent | FileEvent) => void,
  ) => void;
};

type AssetPoolFilesInstance = {
  getPath: (name: string) => Promise<string> | string;
};

type AssetPoolCtor = new (path: string) => AssetPoolInstance;
type AssetPoolFetcherCtor = new (pool: AssetPoolInstance) => AssetPoolFetcherInstance;
type AssetPoolFilesCtor = new (
  pool: AssetPoolInstance,
  list: OtaAsset[],
) => AssetPoolFilesInstance;

type NodeFs = {
  copyFileSync: (src: string, dest: string) => void;
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void;
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { size: number };
};

let pool: AssetPoolInstance | null = null;
let fetcher: AssetPoolFetcherInstance | null = null;
let FetcherClassRef: AssetPoolFetcherCtor | null = null;
let AssetPoolFilesClass: AssetPoolFilesCtor | null = null;
let modulesLoaded = false;
let modulesAvailable = false;
let activeFetch: AssetPoolFetcherInstance | null = null;
let downloadInProgress = false;
let downloadStartedAtMs = 0;
const OTA_POOL_LOCK_MAX_MS = 20 * 60_000;
let boundOtaFileListener: ((event: FileEvent) => void) | null = null;
let boundOtaProgressListener: ((event: ProgressEvent) => void) | null = null;

function detachOtaFetcherListeners(target: AssetPoolFetcherInstance | null): void {
  if (!target) return;
  if (boundOtaFileListener && typeof target.removeEventListener === 'function') {
    try {
      target.removeEventListener('fileevent', boundOtaFileListener);
    } catch {
      /* ignore */
    }
  }
  if (boundOtaProgressListener && typeof target.removeEventListener === 'function') {
    try {
      target.removeEventListener('progressevent', boundOtaProgressListener);
    } catch {
      /* ignore */
    }
  }
  boundOtaFileListener = null;
  boundOtaProgressListener = null;
}

function recreateOtaFetcher(): AssetPoolFetcherInstance | null {
  if (!pool || !FetcherClassRef) return fetcher;
  detachOtaFetcherListeners(fetcher);
  try {
    fetcher = new FetcherClassRef(pool);
    return fetcher;
  } catch (e) {
    console.warn(
      '[Perform6] OTA asset pool fetcher recreate failed',
      e instanceof Error ? e.message : e,
    );
    return fetcher;
  }
}

function getRequire(): BrightSignRequire | null {
  const g = globalThis as { require?: BrightSignRequire };
  if (typeof g.require === 'function') return g.require;
  if (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { require?: BrightSignRequire }).require === 'function'
  ) {
    return (window as unknown as { require: BrightSignRequire }).require;
  }
  return null;
}

function loadModules(): boolean {
  if (modulesLoaded) return modulesAvailable;
  modulesLoaded = true;

  const probe = probeBrightSignAssetPool();
  if (!probe.assetpool || !probe.assetpoolfetcher) {
    modulesAvailable = false;
    console.info('[Perform6] OTA asset pool unavailable', probe);
    return false;
  }

  const req = getRequire();
  if (!req) {
    modulesAvailable = false;
    return false;
  }

  try {
    const PoolClass = req('@brightsign/assetpool') as AssetPoolCtor;
    const FetcherClass = req('@brightsign/assetpoolfetcher') as AssetPoolFetcherCtor;
    FetcherClassRef = FetcherClass;
    const pathCandidates = [OTA_POOL_PATH, OTA_ASSET_POOL_DIR_DOCS];
    let lastErr: unknown = null;
    for (const path of pathCandidates) {
      try {
        pool = new PoolClass(path);
        fetcher = new FetcherClass(pool);
        lastErr = null;
        console.info('[Perform6] OTA asset pool ready', { path });
        break;
      } catch (e) {
        lastErr = e;
        pool = null;
        fetcher = null;
        console.warn(
          '[Perform6] OTA asset pool path failed',
          path,
          e instanceof Error ? e.message : e,
        );
      }
    }
    if (!pool || !fetcher) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error('OTA asset pool unavailable');
    }
    try {
      AssetPoolFilesClass = req('@brightsign/assetpoolfiles') as AssetPoolFilesCtor;
    } catch {
      try {
        AssetPoolFilesClass = req('@brightsign/assetfiles') as AssetPoolFilesCtor;
      } catch {
        AssetPoolFilesClass = null;
      }
    }
    modulesAvailable = true;
  } catch (e) {
    modulesAvailable = false;
    pool = null;
    fetcher = null;
    console.warn(
      '[Perform6] OTA asset pool init failed',
      e instanceof Error ? e.message : e,
    );
  }

  return modulesAvailable;
}

export function isOtaAssetPoolAvailable(): boolean {
  return loadModules();
}

export function isOtaAssetPoolDownloadInProgress(): boolean {
  if (!downloadInProgress) return false;
  if (
    downloadStartedAtMs > 0 &&
    Date.now() - downloadStartedAtMs > OTA_POOL_LOCK_MAX_MS
  ) {
    console.warn('[Perform6] OTA asset pool lock expired — clearing stuck flag');
    downloadInProgress = false;
    downloadStartedAtMs = 0;
    return false;
  }
  return true;
}

export async function cancelOtaAssetPoolFetch(): Promise<void> {
  const target = activeFetch ?? fetcher;
  if (!target) return;
  try {
    await target.cancel();
  } catch {
    /* idle */
  }
}

function assetNameForPath(relPath: string): string {
  return relPath.replace(/^\/+/, '').replace(/\//g, '--');
}

function resolveOtaFileUrl(file: OtaManifestFile): string {
  return `${runtimeConfig.apiBaseUrl}/devices/me/ota-file?path=${encodeURIComponent(file.path)}`;
}

function parseSha256(hex?: string): AssetHash | undefined {
  if (!hex) return undefined;
  const cleaned = hex.trim().toLowerCase().replace(/^sha-?256:/i, '');
  if (/^[a-f0-9]{64}$/.test(cleaned)) return { method: 'sha256', hex: cleaned };
  return undefined;
}

function fileToAsset(file: OtaManifestFile): OtaAsset {
  const rel = file.path.replace(/^\/+/, '');
  const asset: OtaAsset = {
    name: assetNameForPath(rel),
    link: resolveOtaFileUrl(file),
  };
  if (file.sizeBytes > 0) asset.size = file.sizeBytes;
  const hash = parseSha256(file.sha256);
  if (hash) asset.hash = hash;
  else {
    asset.changehint = rel;
    asset.changeHint = rel;
  }
  return asset;
}

function toNodeSdPath(sdPath: string): string {
  const normalized = sdPath.replace(/^sd:/i, 'SD:');
  if (normalized.startsWith('SD:/')) {
    return `/storage/sd/${normalized.slice(4)}`;
  }
  return normalized;
}

function getNodeFs(): NodeFs | null {
  const req = getRequire();
  if (!req) return null;
  try {
    return req('fs') as NodeFs;
  } catch {
    return null;
  }
}

function ensureParentDir(fs: NodeFs, filePath: string): void {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (idx <= 0) return;
  const parent = filePath.slice(0, idx);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

async function resolvePoolPath(
  assetList: OtaAsset[],
  assetName: string,
): Promise<string | null> {
  if (!pool || !AssetPoolFilesClass) return null;
  try {
    const files = new AssetPoolFilesClass(pool, assetList);
    const path = await Promise.resolve(files.getPath(assetName));
    return path && String(path).length > 0 ? String(path) : null;
  } catch {
    return null;
  }
}

function copyPoolFileToSd(poolPath: string, relPath: string): void {
  const fs = getNodeFs();
  if (!fs) {
    throw new Error('Node fs unavailable — cannot realize OTA from asset pool');
  }

  const destSd = `SD:/${relPath.replace(/^\/+/, '')}`;
  const candidates = [
    { src: poolPath, dest: destSd },
    { src: toNodeSdPath(poolPath), dest: toNodeSdPath(destSd) },
    { src: poolPath, dest: toNodeSdPath(destSd) },
    { src: toNodeSdPath(poolPath), dest: destSd },
  ];

  let lastError: unknown;
  for (const { src, dest } of candidates) {
    try {
      ensureParentDir(fs, dest);
      fs.copyFileSync(src, dest);
      const st = fs.statSync(dest);
      if (!st || st.size <= 0) {
        throw new Error(`Copied OTA file empty: ${dest}`);
      }
      console.info('[Perform6] OTA realized', { from: src, to: dest, bytes: st.size });
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`OTA realize copy failed for ${relPath}`);
}

function sdFileSize(relPath: string): number | null {
  const fs = getNodeFs();
  if (!fs) return null;
  const destSd = `SD:/${relPath.replace(/^\/+/, '')}`;
  const candidates = [destSd, toNodeSdPath(destSd)];
  for (const path of candidates) {
    try {
      if (!fs.existsSync(path)) continue;
      const st = fs.statSync(path);
      if (st && st.size > 0) return st.size;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * True when every OTA file is already on SD at the expected size
 * (e.g. download succeeded but REBOOTING ack failed — retry without re-fetch).
 */
export function otaFilesAlreadyOnSd(files: OtaManifestFile[]): boolean {
  if (files.length === 0 || !getNodeFs()) return false;
  for (const file of files) {
    const rel = file.path.replace(/^\/+/, '');
    const expected = file.sizeBytes ?? 0;
    if (expected <= 0) return false;
    const actual = sdFileSize(rel);
    if (actual == null || actual !== expected) return false;
  }
  return true;
}

/**
 * Download full remaining OTA set into perform6-ota-pool, copy to SD:/ paths, then caller reboots.
 * Does not touch media pool or clear-cache paths.
 */
export async function installOtaViaAssetPool(
  auth: DeviceAuthContext,
  manifest: OtaManifestResponse,
  files: OtaManifestFile[],
): Promise<{ ok: boolean; error?: string; realizedPaths?: string[] }> {
  if (!isOtaAssetPoolAvailable() || !pool || !fetcher) {
    return { ok: false, error: 'OTA asset pool unavailable' };
  }
  if (!getNodeFs()) {
    return { ok: false, error: 'Node fs unavailable for OTA realize' };
  }
  if (files.length === 0) {
    return { ok: false, error: 'No OTA files' };
  }

  downloadInProgress = true;
  downloadStartedAtMs = Date.now();
  const runFetcher = recreateOtaFetcher() ?? fetcher;
  if (!runFetcher) {
    downloadInProgress = false;
    downloadStartedAtMs = 0;
    return { ok: false, error: 'OTA asset pool fetcher unavailable' };
  }
  activeFetch = runFetcher;

  const assetList = files.map(fileToAsset);
  const byName = new Map(
    files.map((f) => [assetNameForPath(f.path.replace(/^\/+/, '')), f] as const),
  );
  const failed: Record<string, string> = {};
  const targetVersion = manifest.version ?? '';
  const packageTotal = manifest.packageFileCount ?? files.length;
  const alreadyDone = manifest.completedCount ?? 0;

  try {
    try {
      await Promise.resolve(pool.protectAssets('perform6-ota', assetList));
    } catch (e) {
      console.warn(
        '[Perform6] OTA protectAssets failed (continuing)',
        e instanceof Error ? e.message : e,
      );
    }

    const onFile = (event: FileEvent) => {
      const name = String(event.filename ?? '');
      const file = byName.get(name);
      const code = event.responseCode;
      const ok = code === 200 || code === 226 || code === 0;
      if (!ok && file) {
        failed[file.path] =
          event.error || `OTA asset fetch failed (code ${String(code ?? '?')})`;
      }
      if (file) {
        reportOtaStatusSafe(auth, {
          status: ok ? 'DOWNLOADING' : 'FAILED',
          targetVersion,
          doneCount: alreadyDone,
          totalCount: packageTotal,
          currentPath: file.path,
          error: ok ? undefined : failed[file.path],
          runtimeVersion: runtimeConfig.runtimeVersion,
        });
      }
    };

    const onProgress = (event: ProgressEvent) => {
      const name = String(event.filename ?? '');
      const file = byName.get(name);
      if (!file) return;
      reportOtaStatusSafe(auth, {
        status: 'DOWNLOADING',
        targetVersion,
        doneCount: alreadyDone,
        totalCount: packageTotal,
        currentPath: file.path,
        bytesDownloaded: event.currentFileTransferred,
        bytesTotal: event.currentFileTotal ?? file.sizeBytes,
        runtimeVersion: runtimeConfig.runtimeVersion,
      });
    };

    boundOtaFileListener = onFile;
    boundOtaProgressListener = onProgress;
    runFetcher.addEventListener('fileevent', onFile);
    runFetcher.addEventListener('progressevent', onProgress);

    console.info('[Perform6] OTA asset pool fetch start', {
      pool: OTA_POOL_PATH,
      files: files.length,
      version: targetVersion,
    });

    await runFetcher.start(assetList, {
      headers: {
        Authorization: `Bearer ${auth.apiToken}`,
        'X-Device-Id': auth.deviceId,
      },
    });

    if (Object.keys(failed).length > 0) {
      const first = Object.entries(failed)[0];
      return {
        ok: false,
        error: first ? `${first[0]}: ${first[1]}` : 'OTA asset pool fetch failed',
      };
    }

    const realized: string[] = [];
    for (const file of files) {
      const rel = file.path.replace(/^\/+/, '');
      const name = assetNameForPath(rel);
      if (failed[file.path]) {
        return { ok: false, error: failed[file.path] };
      }
      const poolPath = await resolvePoolPath(assetList, name);
      if (!poolPath) {
        return {
          ok: false,
          error: `OTA pool path missing after fetch: ${rel}`,
        };
      }
      copyPoolFileToSd(poolPath, rel);
      realized.push(rel);
      reportOtaStatusSafe(auth, {
        status: 'DOWNLOADING',
        targetVersion,
        doneCount: alreadyDone + realized.length,
        totalCount: packageTotal,
        currentPath: rel,
        runtimeVersion: runtimeConfig.runtimeVersion,
      });
    }

    console.info('[Perform6] OTA asset pool realize complete', {
      count: realized.length,
      paths: realized,
    });
    return { ok: true, realizedPaths: realized };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[Perform6] OTA asset pool install failed', msg);
    return { ok: false, error: msg || 'OTA asset pool install failed' };
  } finally {
    detachOtaFetcherListeners(runFetcher);
    downloadInProgress = false;
    downloadStartedAtMs = 0;
    activeFetch = null;
  }
}
