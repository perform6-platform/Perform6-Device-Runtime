import { runtimeConfig } from '../config/runtime';
import { useRuntimeStore } from '../stores/runtimeStore';

const PLAYBACK_MESSAGE = 'xt-playback';
const LED_READY_MESSAGE = 'xt-led-ready';
const LED_ENDED_MESSAGE = 'xt-led-ended';

let initialized = false;

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const ctor = window.BSMessagePort;
    return typeof ctor === 'function' ? new ctor() : null;
  } catch (error) {
    console.warn('[Perform6] XT output bridge unavailable', error);
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Native roVideoPlayer cannot play blob: IndexedDB URLs. */
function nativePlayableSrc(src: string | null | undefined, fallbackSrc: string | null | undefined): string {
  const primary = asString(src);
  const fallback = asString(fallbackSrc);
  if (primary && !primary.startsWith('blob:')) return primary;
  if (fallback && !fallback.startsWith('blob:')) return fallback;
  return '';
}

function postTouchPlayback(port: BrightSignMessagePort): void {
  const state = useRuntimeStore.getState();
  const meta = state.displayPlaybackMeta;
  const src = nativePlayableSrc(state.displayVideoSrc, meta?.fallbackSrc);
  port.PostBSMessage({
    type: PLAYBACK_MESSAGE,
    role: 'touch',
    src,
    fallbackSrc: asString(meta?.fallbackSrc).startsWith('blob:')
      ? ''
      : asString(meta?.fallbackSrc),
    mediaVersionId: meta?.mediaVersionId ?? '',
    mediaTitle: meta?.title ?? '',
    screenKey: meta?.screenKey ?? 'SCREEN_1',
    loop: state.displayVideoLoop,
    paused: state.displayPaused,
    restartNonce: state.displayRestartNonce,
  });
}

/**
 * XT2145: HDMI-1 React publishes playback; autorun drives HDMI-2 via roVideoPlayer.
 * No secondary Chromium on the LED.
 */
export function initXtOutputBridge(): void {
  if (
    initialized ||
    runtimeConfig.isSimulator ||
    runtimeConfig.hardwareProfile !== 'XT2145'
  ) {
    return;
  }
  initialized = true;

  // Only the touch/primary HtmlWidget runs this bridge. LED is native video.
  if (runtimeConfig.xtOutputRole === 'led') {
    return;
  }

  const port = createMessagePort();
  if (!port) {
    console.error('[Perform6] BSMessagePort missing — XT HDMI relay cannot start');
    return;
  }

  port.addEventListener('bsmessage', (event) => {
    const type = asString(event.data.type);
    if (type === LED_READY_MESSAGE) {
      postTouchPlayback(port);
    } else if (type === LED_ENDED_MESSAGE) {
      useRuntimeStore.getState().displayVideoEndedHandler?.();
    }
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (
      state.displayVideoSrc !== previous.displayVideoSrc ||
      state.displayPlaybackMeta !== previous.displayPlaybackMeta ||
      state.displayVideoLoop !== previous.displayVideoLoop ||
      state.displayPaused !== previous.displayPaused ||
      state.displayRestartNonce !== previous.displayRestartNonce
    ) {
      postTouchPlayback(port);
    }
  });

  // Publish once in case native LED ready arrived before the listener attached.
  postTouchPlayback(port);
}
