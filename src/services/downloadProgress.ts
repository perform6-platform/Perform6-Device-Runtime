export type DownloadUiPhase = 'idle' | 'downloading' | 'retrying' | 'waiting';

export interface DownloadUiState {
  phase: DownloadUiPhase;
  currentLabel: string | null;
  completedFiles: number;
  totalFiles: number;
  etaSeconds: number | null;
  retryInSeconds: number | null;
}

const IDLE: DownloadUiState = {
  phase: 'idle',
  currentLabel: null,
  completedFiles: 0,
  totalFiles: 0,
  etaSeconds: null,
  retryInSeconds: null,
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
