import { runtimeConfig } from '../config/runtime';
import { isOtaPaused } from './perform6Ops';
import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';
import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import { flushDeviceLogs } from './deviceLogsApi';
import { reportOtaStatusSafe } from './otaStatusApi';
import { compareRuntimeVersions } from './runtimeVersion';
import {
  cancelOtaAssetPoolFetch,
  installOtaViaAssetPool,
  isOtaAssetPoolAvailable,
} from './otaAssetPool';

const OTA_INSTALL_MESSAGE = 'led-ota-install';
const OTA_AUTH_MESSAGE = 'led-ota-auth';
const OTA_PING_MESSAGE = 'led-ota-ping';
const OTA_PROGRESS_TYPE = 'led-ota-progress';
const OTA_REBOOT_MESSAGE = 'led-ota-reboot';
const OTA_CANCEL_MESSAGE = 'led-ota-cancel';

/** After a failed OTA, skip automatic OTA so media sync can recover without competing HTTP. */
const OTA_FAIL_COOLDOWN_MS = 3 * 60_000;
let lastOtaFailAtMs = 0;
let lastOtaFailReason = '';

export function markOtaFailed(reason?: string): void {
  lastOtaFailAtMs = Date.now();
  lastOtaFailReason = reason?.trim() || 'OTA failed';
}

export function clearOtaFailCooldown(): void {
  lastOtaFailAtMs = 0;
  lastOtaFailReason = '';
}

export function shouldSkipOtaAfterRecentFail(): boolean {
  if (lastOtaFailAtMs <= 0) return false;
  return Date.now() - lastOtaFailAtMs < OTA_FAIL_COOLDOWN_MS;
}

export function getLastOtaFailReason(): string {
  return lastOtaFailReason;
}

/** Ask autorun to abort any in-flight OTA transfer so cache/sync can proceed. */
const otaAbortHandlers = new Set<() => void>();

export function cancelOtaInstall(): boolean {
  const port = getSharedMessagePort();
  if (port) {
    port.PostBSMessage({ type: OTA_CANCEL_MESSAGE });
    console.info('[Perform6] OTA cancel sent to autorun');
  }
  void cancelOtaAssetPoolFetch();
  for (const handler of [...otaAbortHandlers]) {
    try {
      handler();
    } catch {
      /* ignore */
    }
  }
  otaAbortHandlers.clear();
  return Boolean(port);
}

export interface OtaManifestFile {
  path: string;
  sizeBytes: number;
  sha256?: string;
  url?: string;
}

export interface OtaManifestResponse {
  updateAvailable: boolean;
  version?: string;
  profile?: string;
  files?: OtaManifestFile[];
  packageFileCount?: number;
  completedCount?: number;
  staged?: boolean;
}

export type OtaProgressStatus = 'start' | 'progress' | 'done' | 'failed' | 'complete';

export interface OtaProgressEvent {
  type: typeof OTA_PROGRESS_TYPE;
  status: OtaProgressStatus;
  path?: string;
  error?: string;
  doneCount?: number;
  totalCount?: number;
  fileIndex?: number;
  bytesDownloaded?: number;
  bytesTotal?: number;
}

/** Always download OTA files via authenticated API proxy (not direct R2 CDN). */
function resolveOtaFileUrl(file: OtaManifestFile): string {
  return `${runtimeConfig.apiBaseUrl}/devices/me/ota-file?path=${encodeURIComponent(file.path)}`;
}

function formatBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function logOtaProgress(
  status: OtaProgressStatus,
  ctx: {
    path?: string;
    doneCount?: number;
    totalCount?: number;
    fileIndex?: number;
    bytesDownloaded?: number;
    bytesTotal?: number;
    detail?: string;
  },
): void {
  const parts = [
    `[Perform6] OTA ${status}`,
    ctx.doneCount != null && ctx.totalCount != null
      ? `${ctx.doneCount}/${ctx.totalCount}`
      : null,
    ctx.fileIndex != null ? `#${ctx.fileIndex}` : null,
    ctx.path ? `file=${ctx.path}` : null,
    ctx.bytesDownloaded != null || ctx.bytesTotal != null
      ? `${formatBytes(ctx.bytesDownloaded)}/${formatBytes(ctx.bytesTotal)}`
      : null,
    ctx.detail ?? null,
  ].filter(Boolean);
  console.info(parts.join(' · '));
}

export async function fetchOtaManifest(auth: DeviceAuthContext): Promise<OtaManifestResponse> {
  const query = new URLSearchParams({
    runtimeVersion: runtimeConfig.runtimeVersion,
  });
  return apiFetchData<OtaManifestResponse>(`/devices/me/ota-manifest?${query}`, {
    token: auth.apiToken,
    deviceId: auth.deviceId,
  });
}

function waitForOtaComplete(
  auth: DeviceAuthContext,
  targetVersion: string,
  totalFiles: number,
  timeoutMs = 60 * 60_000,
): Promise<{ ok: boolean; error?: string }> {
  const port = getSharedMessagePort();
  if (!port) {
    return Promise.resolve({ ok: false, error: 'BSMessagePort unavailable' });
  }

  return new Promise((resolve) => {
    let reportedStart = false;
    let settled = false;
    let lastLogFlushMs = 0;
    let lastDoneCount = 0;
    let lastPath: string | undefined;
    let lastActivityMs = Date.now();
    let lastBytesDownloaded = -1;
    const failedFiles: string[] = [];

    let lastOtaStatusMs = 0;
    const OTA_STATUS_INTERVAL_MS = 3000;

    const reportOtaProgressThrottled = (
      payload: Parameters<typeof reportOtaStatusSafe>[1],
      force = false,
    ) => {
      const now = Date.now();
      if (!force && now - lastOtaStatusMs < OTA_STATUS_INTERVAL_MS) return;
      lastOtaStatusMs = now;
      reportOtaStatusSafe(auth, payload);
    };

    const markActivity = (
      doneCount?: number,
      path?: string,
      bytesDownloaded?: number,
    ) => {
      let progressed = false;
      if (doneCount != null && doneCount > lastDoneCount) {
        lastDoneCount = doneCount;
        progressed = true;
      }
      if (path) lastPath = path;
      if (bytesDownloaded != null && bytesDownloaded >= 0) {
        if (bytesDownloaded > lastBytesDownloaded) progressed = true;
        lastBytesDownloaded = bytesDownloaded;
      }
      if (progressed) lastActivityMs = Date.now();
    };

    const flushLogsThrottled = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastLogFlushMs < 8_000) return;
      lastLogFlushMs = now;
      try {
        await flushDeviceLogs(auth);
      } catch {
        /* best-effort */
      }
    };

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      otaAbortHandlers.delete(onAbort);
      window.clearTimeout(timer);
      window.clearTimeout(startWatchdog);
      window.clearInterval(stallWatchdog);
      unsub();
      if (!result.ok) {
        // Avoid re-entrancy: only tell autorun; handlers already cleared.
        const port = getSharedMessagePort();
        if (port) port.PostBSMessage({ type: OTA_CANCEL_MESSAGE });
        markOtaFailed(result.error);
      } else {
        clearOtaFailCooldown();
      }
      void flushLogsThrottled(true);
      resolve(result);
    };

    const onAbort = () => {
      finish({ ok: false, error: 'OTA cancelled' });
    };
    otaAbortHandlers.add(onAbort);

    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== OTA_PROGRESS_TYPE) return;
      const status = String(data.status ?? '') as OtaProgressStatus;
      const doneCount =
        data.doneCount != null ? Number(data.doneCount) : undefined;
      const totalCount =
        data.totalCount != null ? Number(data.totalCount) : totalFiles;
      const path = data.path != null ? String(data.path) : undefined;
      const fileIndex = data.fileIndex != null ? Number(data.fileIndex) : undefined;
      const bytesDownloaded =
        data.bytesDownloaded != null ? Number(data.bytesDownloaded) : undefined;
      const bytesTotal = data.bytesTotal != null ? Number(data.bytesTotal) : undefined;
      const detail = data.error != null ? String(data.error) : undefined;

      logOtaProgress(status, {
        path,
        doneCount,
        totalCount,
        fileIndex,
        bytesDownloaded,
        bytesTotal,
        detail,
      });

      markActivity(doneCount, path, bytesDownloaded);
      if (status === 'start' || status === 'done') {
        lastActivityMs = Date.now();
      }

      if (status === 'start' || status === 'done' || status === 'progress') {
        if (!reportedStart && status === 'start') reportedStart = true;
        reportOtaProgressThrottled(
          {
            status: 'DOWNLOADING',
            targetVersion,
            doneCount,
            totalCount,
            currentPath: path,
            bytesDownloaded,
            bytesTotal,
            runtimeVersion: runtimeConfig.runtimeVersion,
          },
          status === 'start' || status === 'done',
        );
      }

      if (status === 'start' || status === 'done' || status === 'failed') {
        void flushLogsThrottled(true);
      } else if (status === 'progress') {
        void flushLogsThrottled(false);
      }

      if (status === 'failed') {
        const error = detail ?? path ?? 'OTA download failed';
        failedFiles.push(path ? `${path}: ${error}` : error);
        console.warn('[Perform6] OTA file failed — continuing remaining files', {
          path,
          error,
          failedSoFar: failedFiles.length,
        });
        reportOtaStatusSafe(auth, {
          status: 'DOWNLOADING',
          targetVersion,
          doneCount,
          totalCount,
          currentPath: path,
          bytesDownloaded,
          bytesTotal,
          error,
          runtimeVersion: runtimeConfig.runtimeVersion,
        });
        // Do not abort the whole package on one file; autorun keeps draining the queue.
      } else if (status === 'complete') {
        if (failedFiles.length > 0) {
          const error = `OTA incomplete — ${failedFiles.length} file(s) failed: ${failedFiles.slice(0, 3).join('; ')}`;
          console.warn('[Perform6] OTA finished with failures', { failedFiles });
          reportOtaStatusSafe(auth, {
            status: 'FAILED',
            targetVersion,
            doneCount: totalCount,
            totalCount,
            error,
            runtimeVersion: runtimeConfig.runtimeVersion,
          });
          finish({ ok: false, error });
          return;
        }
        console.info(
          `[Perform6] OTA complete · ${totalCount ?? totalFiles} files · reboot pending`,
        );
        reportOtaStatusSafe(auth, {
          status: 'REBOOTING',
          targetVersion,
          doneCount: totalCount,
          totalCount,
          currentPath: lastPath,
          runtimeVersion: runtimeConfig.runtimeVersion,
        });
        finish({ ok: true });
      }
    });

    const startWatchdog = window.setTimeout(() => {
      if (reportedStart || settled) return;
      const error = 'OTA install did not start (autorun did not acknowledge within 90s)';
      console.warn(`[Perform6] OTA failed · ${error}`);
      reportOtaStatusSafe(auth, {
        status: 'FAILED',
        targetVersion,
        totalCount: totalFiles,
        error,
        runtimeVersion: runtimeConfig.runtimeVersion,
      });
      finish({ ok: false, error });
    }, 90_000);

    /** Autorun averages min transfer rate over 15 minutes — outlast that window. */
    const STALL_MS = 20 * 60_000;
    const stallWatchdog = window.setInterval(() => {
      if (settled || !reportedStart) return;
      if (Date.now() - lastActivityMs < STALL_MS) return;

      const stuckAt = `${lastDoneCount}/${totalFiles}`;
      const fileHint = lastPath ? ` on ${lastPath}` : '';
      const bytesHint =
        lastBytesDownloaded >= 0 ? ` (${lastBytesDownloaded} bytes received)` : '';
      const error = `OTA stalled at ${stuckAt}${fileHint}${bytesHint} — check device internet or use SD deploy`;
      console.warn(`[Perform6] OTA failed · ${error}`);
      reportOtaStatusSafe(auth, {
        status: 'FAILED',
        targetVersion,
        doneCount: lastDoneCount,
        totalCount: totalFiles,
        currentPath: lastPath,
        error,
        runtimeVersion: runtimeConfig.runtimeVersion,
      });
      finish({ ok: false, error });
    }, 30_000);

    const timer = window.setTimeout(
      () => {
        const progress =
          lastDoneCount > 0 || lastPath
            ? ` — completed ${lastDoneCount}/${totalFiles}${lastPath ? `, last file: ${lastPath}` : ''}`
            : '';
        const error = reportedStart
          ? `OTA timed out (60 min)${progress}`
          : 'OTA install did not start (autorun did not acknowledge)';
        console.warn(`[Perform6] OTA failed · ${error}`);
        reportOtaStatusSafe(auth, {
          status: 'FAILED',
          targetVersion,
          doneCount: lastDoneCount,
          totalCount: totalFiles,
          currentPath: lastPath,
          error,
          runtimeVersion: runtimeConfig.runtimeVersion,
        });
        finish({ ok: false, error });
      },
      timeoutMs,
    );
  });
}

function waitForOtaStatusDetail(
  wantDetail: string,
  timeoutMs = 8_000,
): Promise<boolean> {
  const port = getSharedMessagePort();
  if (!port) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(ok);
    };
    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== OTA_PROGRESS_TYPE) return;
      if (String(data.status ?? '') !== 'start') return;
      const detail = String(data.error ?? '');
      if (detail === wantDetail || detail.startsWith(wantDetail)) {
        finish(true);
      }
    });
    const timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

export async function installOtaFromManifest(
  auth: DeviceAuthContext,
  manifest: OtaManifestResponse,
): Promise<{ ok: boolean; error?: string }> {
  const files = [...(manifest.files ?? [])].sort((a, b) => {
    const rank = (path: string) => {
      const p = path.replace(/^\/+/, '').toLowerCase();
      if (p === 'autorun.brs') return 0;
      if (p === 'index.html') return 1;
      if (p.startsWith('assets/')) return 3;
      return 2;
    };
    return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
  });
  if (!manifest.updateAvailable || files.length === 0) {
    return { ok: false, error: 'No OTA files in manifest' };
  }

  const port = getSharedMessagePort();
  if (!port) {
    return { ok: false, error: 'BSMessagePort unavailable (simulator)' };
  }

  const packageTotal = manifest.packageFileCount ?? files.length;
  const alreadyDone = manifest.completedCount ?? 0;
  const targetVersion = manifest.version ?? '';

  // Prefer BrightSign asset pool (SD:/perform6-ota-pool) — isolated from media.
  if (isOtaAssetPoolAvailable()) {
    console.info('[Perform6] OTA via asset pool', {
      version: targetVersion,
      files: files.length,
      pool: 'SD:/perform6-ota-pool',
    });
    otaAbortHandlers.add(() => {
      void cancelOtaAssetPoolFetch();
    });
    const poolResult = await installOtaViaAssetPool(auth, manifest, files);
    if (poolResult.ok) {
      reportOtaStatusSafe(auth, {
        status: 'REBOOTING',
        targetVersion,
        doneCount: alreadyDone + files.length,
        totalCount: packageTotal,
        currentPath: poolResult.realizedPaths?.slice(-1)[0],
        runtimeVersion: runtimeConfig.runtimeVersion,
      });
      console.info(
        `[Perform6] OTA asset pool ok (${files.length} files) — rebooting`,
      );
      port.PostBSMessage({ type: OTA_REBOOT_MESSAGE });
      return { ok: true };
    }
    console.warn(
      '[Perform6] OTA asset pool failed — falling back to autorun HTTP',
      poolResult.error,
    );
  }

  // Fallback: one file per autorun message (legacy custom HTTP).
  const wave = files.slice(0, 1);
  const file = wave[0];
  const fileUrl = resolveOtaFileUrl(file);
  const filePath = file.path.replace(/^\/+/, '');
  const fileSize = String(file.sizeBytes ?? 0);

  console.info('[Perform6] OTA install queue (autorun HTTP):', {
    version: manifest.version,
    profile: manifest.profile,
    staged: manifest.staged === true || wave.length < files.length,
    waveFileCount: wave.length,
    packageProgress: `${alreadyDone}/${packageTotal}`,
    files: wave.map((f, i) => ({
      index: i + 1,
      path: f.path,
      sizeBytes: f.sizeBytes,
      dest: `SD:/${f.path.replace(/^\/+/, '')}`,
    })),
  });

  // Tiny ping first — proves JS↔autorun path before auth/install.
  const pingWait = waitForOtaStatusDetail('pong', 8_000);
  port.PostBSMessage({ type: OTA_PING_MESSAGE });
  const pingOk = await pingWait;
  if (!pingOk) {
    console.warn('[Perform6] OTA bridge ping failed — autorun not answering');
  } else {
    console.info('[Perform6] OTA bridge ping ok');
  }

  // Auth in a separate message so install payload stays small (JWT can be huge).
  const authWait = waitForOtaStatusDetail('auth-ok', 8_000);
  port.PostBSMessage({
    type: OTA_AUTH_MESSAGE,
    authBearer: auth.apiToken,
    deviceId: auth.deviceId,
  });
  const authOk = await authWait;
  if (!authOk) {
    console.warn('[Perform6] OTA auth ack missing — continuing with install anyway');
  }

  const installPromise = waitForOtaComplete(auth, targetVersion, wave.length);

  console.info('[Perform6] OTA sending led-ota-install to autorun', {
    version: targetVersion,
    fileCount: 1,
    path: filePath,
  });

  // Singular keys only — no pipe lists, no authBearer on this message.
  port.PostBSMessage({
    type: OTA_INSTALL_MESSAGE,
    fileUrl,
    filePath,
    fileSize,
    fileSha256: file.sha256 ?? '',
    version: manifest.version ?? '',
    deviceId: auth.deviceId,
  });

  const result = await installPromise;
  if (!result.ok) return result;

  reportOtaStatusSafe(auth, {
    status: 'REBOOTING',
    targetVersion,
    doneCount: alreadyDone + wave.length,
    totalCount: packageTotal,
    currentPath: filePath,
    runtimeVersion: runtimeConfig.runtimeVersion,
  });

  console.info(
    `[Perform6] OTA wave ok (${filePath}) — rebooting so next wave / new autorun can load`,
  );
  port.PostBSMessage({ type: OTA_REBOOT_MESSAGE });
  return { ok: true };
}

export async function applyOtaUpdate(
  auth: DeviceAuthContext,
  options?: { clearFailCooldown?: boolean },
): Promise<{ applied: boolean; version?: string; error?: string }> {
  if (options?.clearFailCooldown) {
    clearOtaFailCooldown();
  }
  if (isOtaPaused()) {
    console.info('[Perform6] OTA skipped — pauseOta in perform6-ops.json');
    return { applied: false, error: 'OTA paused via perform6-ops.json' };
  }

  try {
    console.info('[Perform6] OTA checking manifest', {
      currentVersion: runtimeConfig.runtimeVersion,
    });
    const manifest = await fetchOtaManifest(auth);
    if (!manifest.updateAvailable) {
      console.info('[Perform6] OTA up to date', {
        version: manifest.version ?? runtimeConfig.runtimeVersion,
      });
      return { applied: false, version: manifest.version };
    }

    const target = manifest.version ?? '';
    if (
      target &&
      compareRuntimeVersions(runtimeConfig.runtimeVersion, target) >= 0
    ) {
      console.info(
        `[Perform6] OTA skipped — device ${runtimeConfig.runtimeVersion} >= target ${target} (no downgrade)`,
      );
      return { applied: false, version: target };
    }

    console.info(
      `[Perform6] OTA update ${runtimeConfig.runtimeVersion} → ${manifest.version} (${manifest.files?.length ?? 0} files)`,
    );
    if (manifest.files?.length) {
      for (const [i, file] of manifest.files.entries()) {
        console.info(
          `[Perform6] OTA manifest file ${i + 1}/${manifest.files.length}: ${file.path} (${formatBytes(file.sizeBytes)})`,
        );
      }
    }

    const install = await installOtaFromManifest(auth, manifest);
    try {
      await flushDeviceLogs(auth);
    } catch {
      /* best-effort */
    }
    if (!install.ok) {
      console.warn('[Perform6] OTA install failed', install.error);
      markOtaFailed(install.error);
      cancelOtaInstall();
      reportOtaStatusSafe(auth, {
        status: 'FAILED',
        targetVersion: manifest.version,
        error: install.error,
        runtimeVersion: runtimeConfig.runtimeVersion,
      });
      return { applied: false, version: manifest.version, error: install.error };
    }

    console.info('[Perform6] OTA install complete — rebooting');
    return { applied: true, version: manifest.version };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OTA failed';
    console.warn('[Perform6] OTA apply error', message);
    markOtaFailed(message);
    cancelOtaInstall();
    reportOtaStatusSafe(auth, {
      status: 'FAILED',
      error: message,
      runtimeVersion: runtimeConfig.runtimeVersion,
    });
    try {
      await flushDeviceLogs(auth);
    } catch {
      /* best-effort */
    }
    return { applied: false, error: message };
  }
}
