import { runtimeConfig } from '../config/runtime';
import { isOtaPaused } from './perform6Ops';
import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';
import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import { flushDeviceLogs } from './deviceLogsApi';
import { reportOtaStatusSafe } from './otaStatusApi';

const OTA_INSTALL_MESSAGE = 'led-ota-install';
const OTA_PROGRESS_TYPE = 'led-ota-progress';
const OTA_REBOOT_MESSAGE = 'led-ota-reboot';

export interface OtaManifestFile {
  path: string;
  sizeBytes: number;
  url?: string;
}

export interface OtaManifestResponse {
  updateAvailable: boolean;
  version?: string;
  profile?: string;
  files?: OtaManifestFile[];
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

function needsDeviceAuth(_url: string): boolean {
  return true;
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
      lastActivityMs = Date.now();
      if (doneCount != null) lastDoneCount = doneCount;
      if (path) lastPath = path;
      if (bytesDownloaded != null && bytesDownloaded >= 0) {
        lastBytesDownloaded = bytesDownloaded;
      }
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
      window.clearTimeout(timer);
      window.clearTimeout(startWatchdog);
      window.clearInterval(stallWatchdog);
      unsub();
      void flushLogsThrottled(true);
      resolve(result);
    };

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
        reportOtaStatusSafe(auth, {
          status: 'FAILED',
          targetVersion,
          doneCount,
          totalCount,
          currentPath: path,
          bytesDownloaded,
          bytesTotal,
          error,
          runtimeVersion: runtimeConfig.runtimeVersion,
        });
        finish({ ok: false, error });
      } else if (status === 'complete') {
        console.info(
          `[Perform6] OTA complete · ${totalCount ?? totalFiles} files · reboot pending`,
        );
        reportOtaStatusSafe(auth, {
          status: 'REBOOTING',
          targetVersion,
          doneCount: totalCount,
          totalCount,
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

    /** Fail fast when stuck on one file (e.g. 0/16 network hang on legacy autorun). */
    const STALL_MS = 3 * 60_000;
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

export async function installOtaFromManifest(
  auth: DeviceAuthContext,
  manifest: OtaManifestResponse,
): Promise<{ ok: boolean; error?: string }> {
  const files = manifest.files ?? [];
  if (!manifest.updateAvailable || files.length === 0) {
    return { ok: false, error: 'No OTA files in manifest' };
  }

  const port = getSharedMessagePort();
  if (!port) {
    return { ok: false, error: 'BSMessagePort unavailable (simulator)' };
  }

  const urls = files.map((file) => resolveOtaFileUrl(file));
  const paths = files.map((file) => file.path);
  const sizes = files.map((file) => String(file.sizeBytes ?? 0));
  const authNeeded = urls.some(needsDeviceAuth);

  console.info('[Perform6] OTA install queue:', {
    version: manifest.version,
    profile: manifest.profile,
    fileCount: files.length,
    files: files.map((f, i) => ({
      index: i + 1,
      path: f.path,
      sizeBytes: f.sizeBytes,
      dest: `SD:/${f.path.replace(/^\/+/, '')}`,
    })),
  });

  const targetVersion = manifest.version ?? '';
  const installPromise = waitForOtaComplete(auth, targetVersion, files.length);

  console.info('[Perform6] OTA sending led-ota-install to autorun', {
    version: targetVersion,
    fileCount: files.length,
  });

  port.PostBSMessage({
    type: OTA_INSTALL_MESSAGE,
    fileUrls: urls.join('|'),
    filePaths: paths.join('|'),
    fileSizes: sizes.join('|'),
    authBearer: authNeeded ? auth.apiToken : '',
    deviceId: authNeeded ? auth.deviceId : '',
    version: manifest.version ?? '',
  });

  const result = await installPromise;
  if (!result.ok) return result;

  console.info('[Perform6] OTA sending reboot command to autorun');
  port.PostBSMessage({ type: OTA_REBOOT_MESSAGE });
  return { ok: true };
}

export async function applyOtaUpdate(
  auth: DeviceAuthContext,
): Promise<{ applied: boolean; version?: string; error?: string }> {
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
