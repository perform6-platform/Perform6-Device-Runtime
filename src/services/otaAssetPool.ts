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

type AssetPoolCtor = new (path: string) => AssetPoolInstance;
type AssetPoolFetcherCtor = new (pool: AssetPoolInstance) => AssetPoolFetcherInstance;

type AssetRealizerInstance = {
  realize: (assets: OtaAsset[]) => Promise<void>;
  validateFiles: (
    assets: OtaAsset[],
    options: { deleteCorrupt: boolean },
  ) => Promise<Array<{ name?: string; reason?: string }>>;
};
type AssetRealizerCtor = new (
  pool: AssetPoolInstance,
  destinationPath: string,
) => AssetRealizerInstance;

type NodeFs = {
  copyFileSync: (src: string, dest: string) => void;
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void;
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { size: number };
  writeFileSync: (path: string, data: string, encoding?: string) => void;
};

let pool: AssetPoolInstance | null = null;
let fetcher: AssetPoolFetcherInstance | null = null;
let FetcherClassRef: AssetPoolFetcherCtor | null = null;
let AssetRealizerClass: AssetRealizerCtor | null = null;
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
      AssetRealizerClass = req('@brightsign/assetrealizer') as AssetRealizerCtor;
    } catch {
      AssetRealizerClass = null;
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
  // Asset names cannot contain slashes. The activation map restores paths.
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
  const nodePath = filePath.startsWith('/storage/sd')
    ? filePath.replace(/\\/g, '/')
    : toNodeSdPath(filePath);
  const idx = nodePath.lastIndexOf('/');
  if (idx <= 0) return;
  const parent = nodePath.slice(0, idx);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function safeVersionDir(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

function activateStagedPackage(
  files: OtaManifestFile[],
  stageRoot: string,
  version: string,
): string[] {
  const fs = getNodeFs();
  if (!fs) throw new Error('Node fs unavailable for OTA activation');
  const backupRoot = `/storage/sd/perform6-recovery/${safeVersionDir(version)}`;
  const activated: string[] = [];
  const attempted: string[] = [];

  try {
    for (const file of files) {
      const rel = file.path.replace(/^\/+/, '');
      const staged = `${stageRoot}/${assetNameForPath(rel)}`;
      const active = `/storage/sd/${rel}`;
      const backup = `${backupRoot}/${rel}`;
      attempted.push(rel);
      if (!fs.existsSync(staged)) throw new Error(`OTA staged file missing: ${rel}`);
      const stagedSize = fs.statSync(staged).size;
      if (file.sizeBytes > 0 && stagedSize !== file.sizeBytes) {
        throw new Error(
          `OTA staged size mismatch: ${rel} expected ${file.sizeBytes}, got ${stagedSize}`,
        );
      }
      ensureParentDir(fs, active);
      if (fs.existsSync(active)) {
        ensureParentDir(fs, backup);
        fs.copyFileSync(active, backup);
      }
      fs.copyFileSync(staged, active);
      if (fs.statSync(active).size !== stagedSize) {
        throw new Error(`OTA activation size mismatch: ${rel}`);
      }
      activated.push(rel);
    }
    fs.writeFileSync(
      '/storage/sd/perform6-ota-pending.json',
      JSON.stringify({
        version,
        backupRoot,
        paths: activated,
        activatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
  } catch (error) {
    for (const rel of attempted.reverse()) {
      const backup = `${backupRoot}/${rel}`;
      if (!fs.existsSync(backup)) continue;
      const active = `/storage/sd/${rel}`;
      ensureParentDir(fs, active);
      fs.copyFileSync(backup, active);
    }
    throw error;
  }
  return activated;
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

    if (!AssetRealizerClass) {
      return {
        ok: false,
        error: 'BrightSign AssetRealizer unavailable — refusing unsafe pool copy',
      };
    }

    const stageRoot = `/storage/sd/perform6-ota-stage/${safeVersionDir(targetVersion)}`;
    const fs = getNodeFs();
    if (!fs) return { ok: false, error: 'Node fs unavailable for OTA staging' };
    if (!fs.existsSync(stageRoot)) fs.mkdirSync(stageRoot, { recursive: true });
    const realizer = new AssetRealizerClass(pool, stageRoot);
    await realizer.realize(assetList);
    const invalid = await realizer.validateFiles(assetList, { deleteCorrupt: false });
    if (invalid.length > 0) {
      const first = invalid[0];
      return {
        ok: false,
        error: `OTA staged validation failed: ${first?.name ?? '?'} ${first?.reason ?? ''}`.trim(),
      };
    }

    const realized = activateStagedPackage(files, stageRoot, targetVersion);
    for (const rel of realized) {
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
