export type DownloadUiPhase = 'idle' | 'downloading' | 'retrying' | 'waiting' | 'error';

export interface DownloadUiState {
  phase: DownloadUiPhase;
  currentLabel: string | null;
  completedFiles: number;
  totalFiles: number;
  /** SD path for the active file, e.g. SD:/perform6-cache/12345.mp4 */
  cachePath: string | null;
  /** Bytes written for the active file (.part or final). */
  fileBytesDownloaded: number;
  fileBytesTotal: number | null;
  /** Sum of completed file sizes + active file bytes in this sync batch. */
  batchBytesDownloaded: number;
  batchBytesTotal: number | null;
  etaSeconds: number | null;
  retryInSeconds: number | null;
  statusMessage: string | null;
}

const IDLE: DownloadUiState = {
  phase: 'idle',
  currentLabel: null,
  completedFiles: 0,
  totalFiles: 0,
  cachePath: null,
  fileBytesDownloaded: 0,
  fileBytesTotal: null,
  batchBytesDownloaded: 0,
  batchBytesTotal: null,
  etaSeconds: null,
  retryInSeconds: null,
  statusMessage: null,
};

let state: DownloadUiState = { ...IDLE };
const listeners = new Set<(next: DownloadUiState) => void>();

export function getDownloadUiState(): DownloadUiState {
  return state;
}

export function setDownloadUiState(partial: Partial<DownloadUiState>): void {
  state = { ...state, ...partial };
  for (const listener of listeners) listener(state);
}

export function resetDownloadUiState(): void {
  state = { ...IDLE };
  for (const listener of listeners) listener(state);
}

export function subscribeDownloadUi(listener: (next: DownloadUiState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** Rough signage throughput for ETA labels (bytes per second). */
export const DOWNLOAD_ETA_BYTES_PER_SEC = 400_000;

export function estimateEtaSeconds(remainingBytes: number): number | null {
  if (remainingBytes <= 0) return null;
  return Math.max(30, Math.ceil(remainingBytes / DOWNLOAD_ETA_BYTES_PER_SEC));
}
