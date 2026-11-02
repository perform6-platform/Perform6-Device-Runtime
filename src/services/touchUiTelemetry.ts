export type TouchUiPlaybackState = 'MENU' | 'MODAL' | 'PLAYING' | 'PAUSED';

export interface TouchCurrentContent {
  slot: string;
  title: string | null;
  mediaVersionId: string | null;
  screenKey: string;
  sessionStartedAt: number | null;
  /** Played time with pause excluded. Null when no session is open. */
  sessionElapsedMs?: number | null;
}

export interface TouchUiState {
  playbackState: TouchUiPlaybackState;
  currentContent: TouchCurrentContent | null;
}

const defaultState: TouchUiState = {
  playbackState: 'MENU',
  currentContent: null,
};

let touchUiState: TouchUiState = { ...defaultState };

export function getTouchUiState(): TouchUiState {
  return touchUiState;
}

export function setTouchUiState(partial: Partial<TouchUiState>): void {
  touchUiState = {
    ...touchUiState,
    ...partial,
    currentContent:
      partial.currentContent === undefined
        ? touchUiState.currentContent
        : partial.currentContent,
  };
}

export function resetTouchUiState(): void {
  touchUiState = { ...defaultState };
}

let sessionOriginMs: number | null = null;
let sessionKey: string | null = null;
let pausedTotalMs = 0;
let pauseStartedAt: number | null = null;

/** Tracks played time for monitoring. Does not affect the player or the HDMI bridge. */
export function syncSessionClock(input: {
  active: boolean;
  startedAt: number | null;
  paused: boolean;
}): void {
  if (!input.active || input.startedAt == null) {
    sessionOriginMs = null;
    sessionKey = null;
    pausedTotalMs = 0;
    pauseStartedAt = null;
    return;
  }

  const key = String(input.startedAt);
  if (key !== sessionKey) {
    sessionKey = key;
    sessionOriginMs = input.startedAt;
    pausedTotalMs = 0;
    pauseStartedAt = null;
  }

  if (input.paused) {
    if (pauseStartedAt == null) pauseStartedAt = Date.now();
    return;
  }

  if (pauseStartedAt != null) {
    pausedTotalMs += Date.now() - pauseStartedAt;
    pauseStartedAt = null;
  }
}

/** Milliseconds the session has actually been playing. Frozen while paused. */
export function readSessionElapsedMs(now = Date.now()): number | null {
  if (sessionOriginMs == null) return null;
  const activePause = pauseStartedAt != null ? now - pauseStartedAt : 0;
  return Math.max(0, now - sessionOriginMs - pausedTotalMs - activePause);
}

export function buildTouchCurrentContent(input: {
  slot: string;
  title?: string | null;
  mediaVersionId?: string | null;
  screenKey?: string;
  sessionStartedAt?: number | null;
}): TouchCurrentContent {
  return {
    slot: input.slot,
    title: input.title ?? null,
    mediaVersionId: input.mediaVersionId ?? null,
    screenKey: input.screenKey ?? 'SCREEN_1',
    sessionStartedAt: input.sessionStartedAt ?? null,
  };
}
