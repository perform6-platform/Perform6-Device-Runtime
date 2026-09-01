import { runtimeConfig } from '../config/runtime';
import { isLocalPlaybackSrc } from '../services/playbackSrc';
import { useRuntimeStore } from '../stores/runtimeStore';

const PLAYBACK_MESSAGE = 'xt-playback';
const LED_READY_MESSAGE = 'xt-led-ready';
const LED_ENDED_MESSAGE = 'xt-led-ended';

let initialized = false;
/** Suppress xt-led-ended briefly after Restart (StopClear can fake MediaEnded). */
let ignoreLedEndedUntil = 0;

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

/** Native roVideoPlayer: local SD/file only. Never HTTPS VOD. */
function nativePlayableSrc(src: string | null | undefined, fallbackSrc: string | null | undefined): string {
  const primary = asString(src);
  const fallback = asString(fallbackSrc);
  if (isLocalPlaybackSrc(primary)) return primary;
  if (isLocalPlaybackSrc(fallback)) return fallback;
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
    fallbackSrc: isLocalPlaybackSrc(asString(meta?.fallbackSrc))
      ? asString(meta?.fallbackSrc)
      : '',
    mediaVersionId: meta?.mediaVersionId ?? '',
    mediaTitle: meta?.title ?? '',
    screenKey: meta?.screenKey ?? 'SCREEN_1',
    // BSMessagePort is flat and loosely typed — send transport flags as strings
    // so BrightScript never receives an ambiguous boolean.
    loop: state.displayVideoLoop ? 'true' : 'false',
    paused: state.displayPaused ? 'true' : 'false',
    muted: state.displayMuted ? 'true' : 'false',
    // Native SetVolume is 0–100; mute forces silence on the LED.
    volumePercent: String(
      state.displayMuted
        ? 0
        : Math.max(0, Math.min(100, Math.round(state.displayVolume * 100))),
    ),
    restartNonce: String(state.displayRestartNonce),
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
      if (Date.now() < ignoreLedEndedUntil) {
        console.info('[Perform6] Ignoring LED ended after restart');
        return;
      }
      useRuntimeStore.getState().displayVideoEndedHandler?.();
    }
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (state.displayRestartNonce !== previous.displayRestartNonce) {
      // Cover StopClear → MediaEnded race on the native player.
      ignoreLedEndedUntil = Date.now() + 1500;
    }
    if (
      state.displayVideoSrc !== previous.displayVideoSrc ||
      state.displayPlaybackMeta !== previous.displayPlaybackMeta ||
      state.displayVideoLoop !== previous.displayVideoLoop ||
      state.displayPaused !== previous.displayPaused ||
      state.displayMuted !== previous.displayMuted ||
      state.displayVolume !== previous.displayVolume ||
      state.displayRestartNonce !== previous.displayRestartNonce
    ) {
      postTouchPlayback(port);
    }
  });

  // Publish once in case native LED ready arrived before the listener attached.
  postTouchPlayback(port);
}
