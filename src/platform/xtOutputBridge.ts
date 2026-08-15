import { runtimeConfig } from '../config/runtime';
import { resolveLocalPlaybackUrl } from '../services/media';
import { useRuntimeStore } from '../stores/runtimeStore';

const PLAYBACK_MESSAGE = 'xt-playback';
const LED_READY_MESSAGE = 'xt-led-ready';
const LED_ENDED_MESSAGE = 'xt-led-ended';

let initialized = false;
let ledUpdateSequence = 0;
let lastRelayedRestartNonce = 0;

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const ctor = window.BSMessagePort;
    return typeof ctor === 'function' ? new ctor() : null;
  } catch (error) {
    console.warn('[Perform6] XT output bridge unavailable', error);
    return null;
  }
}

function postTouchPlayback(port: BrightSignMessagePort): void {
  const state = useRuntimeStore.getState();
  const meta = state.displayPlaybackMeta;
  port.PostBSMessage({
    type: PLAYBACK_MESSAGE,
    role: 'touch',
    src: state.displayVideoSrc ?? '',
    fallbackSrc: meta?.fallbackSrc ?? '',
    mediaVersionId: meta?.mediaVersionId ?? '',
    mediaTitle: meta?.title ?? '',
    screenKey: meta?.screenKey ?? 'SCREEN_1',
    loop: state.displayVideoLoop,
    paused: state.displayPaused,
    restartNonce: state.displayRestartNonce,
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function applyLedPlayback(message: Record<string, unknown>): Promise<void> {
  const sequence = ++ledUpdateSequence;
  const mediaVersionId = asString(message.mediaVersionId);
  const relayedSrc = asString(message.src);
  const fallbackSrc = asString(message.fallbackSrc);

  let src: string | null = null;
  if (mediaVersionId) {
    try {
      src = await resolveLocalPlaybackUrl(mediaVersionId);
    } catch (error) {
      console.warn('[Perform6] LED local media lookup failed', error);
    }
  }
  if (!src) {
    src = fallbackSrc || (!relayedSrc.startsWith('blob:') ? relayedSrc : '') || null;
  }
  if (sequence !== ledUpdateSequence) return;

  const store = useRuntimeStore.getState();
  store.setDisplayVideoLoop(asBoolean(message.loop, true));
  store.setDisplayPaused(asBoolean(message.paused, false));
  store.setDisplayVideoSrc(src, {
    screenKey: asString(message.screenKey) || 'SCREEN_1',
    mediaVersionId: mediaVersionId || null,
    title: asString(message.mediaTitle) || null,
    fallbackSrc: fallbackSrc || null,
  });

  const restartNonce = asNumber(message.restartNonce, lastRelayedRestartNonce);
  if (restartNonce !== lastRelayedRestartNonce) {
    lastRelayedRestartNonce = restartNonce;
    useRuntimeStore.getState().restartDisplayVideo();
  }
}

/**
 * Connect the two independent XT2145 browser surfaces through autorun.brs.
 * HDMI-1 publishes playback state; HDMI-2 never pairs or syncs on its own.
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

  const port = createMessagePort();
  if (!port) {
    console.error('[Perform6] BSMessagePort missing — XT HDMI relay cannot start');
    return;
  }

  if (runtimeConfig.xtOutputRole === 'touch') {
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
    return;
  }

  port.addEventListener('bsmessage', (event) => {
    if (asString(event.data.type) === PLAYBACK_MESSAGE) {
      void applyLedPlayback(event.data);
    }
  });
  useRuntimeStore.getState().setDisplayVideoEndedHandler(() => {
    port.PostBSMessage({ type: LED_ENDED_MESSAGE, role: 'led' });
  });
  port.PostBSMessage({ type: LED_READY_MESSAGE, role: 'led' });
}
