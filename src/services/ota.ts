import { resolveMediaFileUrl } from './manifest';

export interface RuntimeUpdateInfo {
  version?: string;
  fileUrl?: string;
  checksum?: string | null;
  updateAvailable?: boolean;
}

export interface OtaCheckResult {
  updateAvailable: boolean;
  version?: string;
  downloadUrl: string | null;
  reachable: boolean;
  error?: string;
}

/** Resolve OTA / startup ZIP URL (absolute R2 CDN or API-relative). */
export function resolveReleaseDownloadUrl(fileUrl: string | undefined | null): string | null {
  if (!fileUrl) return null;
  const resolved = resolveMediaFileUrl(fileUrl);
  return resolved || null;
}

/**
 * When sync reports an update, verify the ZIP is reachable from perform6-releases
 * (via its public/CDN URL). Full apply is BrightSign-side; simulator only probes.
 */
export async function checkOtaUpdate(
  runtime?: RuntimeUpdateInfo | null,
): Promise<OtaCheckResult> {
  if (!runtime?.updateAvailable || !runtime.fileUrl) {
    return {
      updateAvailable: false,
      version: runtime?.version,
      downloadUrl: null,
      reachable: false,
    };
  }

  const downloadUrl = resolveReleaseDownloadUrl(runtime.fileUrl);
  if (!downloadUrl) {
    return {
      updateAvailable: true,
      version: runtime.version,
      downloadUrl: null,
      reachable: false,
      error: 'Missing release file URL',
    };
  }

  try {
    const head = await fetch(downloadUrl, { method: 'HEAD' });
    if (head.ok) {
      return {
        updateAvailable: true,
        version: runtime.version,
        downloadUrl,
        reachable: true,
      };
    }

    // Some CDNs disallow HEAD — probe first byte.
    const range = await fetch(downloadUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    if (range.ok || range.status === 206) {
      return {
        updateAvailable: true,
        version: runtime.version,
        downloadUrl,
        reachable: true,
      };
    }

    return {
      updateAvailable: true,
      version: runtime.version,
      downloadUrl,
      reachable: false,
      error: `Release URL returned ${range.status}`,
    };
  } catch (error) {
    return {
      updateAvailable: true,
      version: runtime.version,
      downloadUrl,
      reachable: false,
      error: error instanceof Error ? error.message : 'OTA probe failed',
    };
  }
}
