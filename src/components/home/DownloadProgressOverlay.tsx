import type { DownloadUiState } from '../../services/downloadProgress';
import { formatBytes, formatPercent } from '../../lib/formatBytes';

function formatEta(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 60) return 'less than 1 min';
  const mins = Math.ceil(seconds / 60);
  return mins === 1 ? 'about 1 min' : `about ${mins} min`;
}

type DownloadProgressOverlayProps = {
  ui: DownloadUiState;
  programsReadyCount: number;
  programsTotalCount: number;
};

export function DownloadProgressOverlay({
  ui,
  programsReadyCount,
  programsTotalCount,
}: DownloadProgressOverlayProps) {
  const eta = formatEta(ui.etaSeconds);
  const filePercent = formatPercent(ui.fileBytesDownloaded, ui.fileBytesTotal);
  const batchPercent = formatPercent(ui.batchBytesDownloaded, ui.batchBytesTotal);

  const statusLine =
    ui.phase === 'error'
      ? ui.statusMessage ?? 'Download failed'
      : ui.phase === 'retrying'
        ? ui.retryInSeconds != null
          ? ui.statusMessage ?? `Connection lost — retrying in ${ui.retryInSeconds}s`
          : ui.statusMessage ?? 'Connection lost — retrying…'
        : ui.phase === 'downloading'
          ? ui.statusMessage ?? 'Downloading to SD card'
          : ui.phase === 'waiting'
            ? 'Retrying download automatically'
            : 'Preparing download';

  const fileProgressLabel =
    ui.fileBytesTotal != null && ui.fileBytesTotal > 0
      ? `${formatBytes(ui.fileBytesDownloaded)} / ${formatBytes(ui.fileBytesTotal)}`
      : ui.fileBytesDownloaded > 0
        ? `${formatBytes(ui.fileBytesDownloaded)} downloaded`
        : null;

  const batchProgressLabel =
    ui.batchBytesTotal != null && ui.batchBytesTotal > 0
      ? `${formatBytes(ui.batchBytesDownloaded)} / ${formatBytes(ui.batchBytesTotal)} total`
      : ui.totalFiles > 0
        ? `File ${Math.min(ui.completedFiles + (ui.cachePath ? 1 : 0), ui.totalFiles)} of ${ui.totalFiles}`
        : null;

  return (
    <aside
      className="p6-download-overlay"
      aria-live="polite"
      aria-label="Video download progress"
    >
      <p className="p6-download-overlay__status">{statusLine}</p>
      {ui.currentLabel ? (
        <p className="p6-download-overlay__title">{ui.currentLabel}</p>
      ) : null}
      {ui.cachePath ? (
        <p className="p6-download-overlay__path" title={ui.cachePath}>
          {ui.cachePath}
        </p>
      ) : null}
      {filePercent != null ? (
        <div className="p6-download-overlay__bar-wrap">
          <div
            className="p6-download-overlay__bar"
            role="progressbar"
            aria-valuenow={filePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Current file download progress"
          >
            <span
              className="p6-download-overlay__bar-fill"
              style={{ width: `${filePercent}%` }}
            />
          </div>
          <p className="p6-download-overlay__bytes">
            {fileProgressLabel}
            {filePercent != null ? ` · ${filePercent}%` : ''}
          </p>
        </div>
      ) : null}
      {batchProgressLabel ? (
        <p className="p6-download-overlay__meta">
          {batchProgressLabel}
          {batchPercent != null ? ` · ${batchPercent}%` : ''}
          {programsTotalCount > 0
            ? ` · ${programsReadyCount}/${programsTotalCount} programs ready`
            : ''}
          {eta ? ` · ${eta} left` : ''}
        </p>
      ) : programsTotalCount > 0 ? (
        <p className="p6-download-overlay__meta">
          {programsReadyCount} of {programsTotalCount} programs ready
          {eta ? ` · ${eta} left` : ''}
        </p>
      ) : null}
    </aside>
  );
}
