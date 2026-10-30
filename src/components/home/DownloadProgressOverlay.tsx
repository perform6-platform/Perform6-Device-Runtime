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
  programLabel?: string;
  onReturnToMenu?: () => void;
};

export function DownloadProgressOverlay({
  ui,
  programsReadyCount,
  programsTotalCount,
  programLabel,
  onReturnToMenu,
}: DownloadProgressOverlayProps) {
  const eta = formatEta(ui.etaSeconds);
  const filePercent = formatPercent(ui.fileBytesDownloaded, ui.fileBytesTotal);
  const batchPercent = formatPercent(ui.batchBytesDownloaded, ui.batchBytesTotal);
  const progressPercent = filePercent ?? batchPercent;
  const focused = Boolean(programLabel);

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

  const content = (
    <aside
      className={`p6-download-overlay${focused ? ' p6-download-overlay--focused' : ''}`}
      aria-live="polite"
      aria-label="Video download progress"
      role={focused ? 'dialog' : 'status'}
      aria-modal={focused ? true : undefined}
    >
      <p className="p6-download-overlay__status">
        {focused
          ? ui.phase === 'error'
            ? 'DOWNLOAD NEEDS ATTENTION'
            : 'VIDEO DOWNLOADING'
          : statusLine}
      </p>
      {focused ? (
        <>
          <h2 className="p6-download-overlay__heading">
            {programLabel} is being downloaded to this device.
          </h2>
          <p className="p6-download-overlay__message">
            {ui.phase === 'error'
              ? statusLine
              : 'This program will become available automatically when the download finishes.'}
          </p>
        </>
      ) : ui.currentLabel ? (
        <p className="p6-download-overlay__title">{ui.currentLabel}</p>
      ) : null}
      {!focused && ui.cachePath ? (
        <p className="p6-download-overlay__path" title={ui.cachePath}>
          {ui.cachePath}
        </p>
      ) : null}
      {progressPercent != null ? (
        <div className="p6-download-overlay__bar-wrap">
          <div
            className="p6-download-overlay__bar"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Current file download progress"
          >
            <span
              className="p6-download-overlay__bar-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="p6-download-overlay__bytes">
            {focused ? 'Download progress' : fileProgressLabel}
            {progressPercent != null ? ` · ${progressPercent}%` : ''}
          </p>
        </div>
      ) : null}
      {focused && progressPercent == null ? (
        <p className="p6-download-overlay__preparing">{statusLine}</p>
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
      {focused && onReturnToMenu ? (
        <button
          type="button"
          className="p6-download-overlay__return"
          onClick={onReturnToMenu}
        >
          RETURN TO MENU
        </button>
      ) : null}
    </aside>
  );

  return focused ? <div className="p6-download-overlay__scrim">{content}</div> : content;
}
