export type TouchUiPlaybackState = 'MENU' | 'MODAL' | 'PLAYING' | 'PAUSED';

export interface TouchCurrentContent {
  slot: string;
  title: string | null;
  mediaVersionId: string | null;
  screenKey: string;
  sessionStartedAt: number | null;
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
