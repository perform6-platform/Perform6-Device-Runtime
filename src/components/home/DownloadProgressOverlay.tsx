import type { DownloadUiState } from '../../services/downloadProgress';

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
  const statusLine =
    ui.phase === 'retrying'
      ? ui.retryInSeconds != null
        ? `Connection lost — retrying in ${ui.retryInSeconds}s`
        : 'Connection lost — retrying…'
      : ui.phase === 'downloading'
        ? 'Downloading'
        : ui.phase === 'waiting'
          ? 'Retrying download automatically'
          : 'Preparing download';

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
      {programsTotalCount > 0 ? (
        <p className="p6-download-overlay__meta">
          {programsReadyCount} of {programsTotalCount} programs ready
          {eta ? ` · ${eta} left` : ''}
        </p>
      ) : null}
    </aside>
  );
}
