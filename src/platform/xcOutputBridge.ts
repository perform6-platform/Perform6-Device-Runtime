import { runtimeConfig } from '../config/runtime';
import { findScreenForTarget, getCurrentVideo } from '../services/playback';
import { resolveLocalPlaybackUrl } from '../services/media';
import type { DisplayTarget } from '../shared/types';
import { useRuntimeStore } from '../stores/runtimeStore';

const PLAYBACK_MESSAGE = 'xc-playback';
const LED_READY_MESSAGE = 'xc-led-ready';

let initialized = false;
let ledUpdateSequence = 0;
let lastRelayedRestartNonce = 0;
let publishSequence = 0;

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const ctor = window.BSMessagePort;
    return typeof ctor === 'function' ? new ctor() : null;
  } catch (error) {
    console.warn('[Perform6] XC output bridge unavailable', error);
    return null;
  }
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

async function resolvePlayableSrc(
  mediaVersionId: string,
  fallbackSrc: string,
): Promise<string | null> {
  if (mediaVersionId) {
    try {
      const local = await resolveLocalPlaybackUrl(mediaVersionId);
      if (local && !local.startsWith('blob:')) return local;
    } catch (error) {
      console.warn('[Perform6] XC local media lookup failed', error);
    }
  }
  return fallbackSrc || null;
}

async function postScreenPlayback(
  port: BrightSignMessagePort,
  target: 'led2' | 'led3',
  screenKey: DisplayTarget,
): Promise<void> {
  const manifest = useRuntimeStore.getState().playbackState.manifest;
  const screen = manifest ? findScreenForTarget(manifest, screenKey) : undefined;
  const video = getCurrentVideo(screen);
  const mediaVersionId = video?.id ?? '';
  const fallbackSrc = video?.url ?? '';
  const src = (await resolvePlayableSrc(mediaVersionId, fallbackSrc)) ?? '';

  port.PostBSMessage({
    type: PLAYBACK_MESSAGE,
    role: 'primary',
    target,
    src,
    fallbackSrc,
    mediaVersionId,
    mediaTitle: video?.title ?? '',
    screenKey,
    loop: true,
    paused: false,
    restartNonce: 0,
  });
}

async function publishSecondaryScreens(port: BrightSignMessagePort): Promise<void> {
  const sequence = ++publishSequence;
  await postScreenPlayback(port, 'led2', 'SCREEN_2');
  if (sequence !== publishSequence) return;
  await postScreenPlayback(port, 'led3', 'SCREEN_3');
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
      if (src?.startsWith('blob:')) src = null;
    } catch (error) {
      console.warn('[Perform6] XC LED local media lookup failed', error);
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
 * XC4055: HDMI-1 owns pairing/sync and publishes SCREEN_2 / SCREEN_3
 * to independent LED widgets. Secondary widgets never pair.
 */
export function initXcOutputBridge(): void {
  if (
    initialized ||
    runtimeConfig.isSimulator ||
    runtimeConfig.hardwareProfile !== 'XC4055'
  ) {
    return;
  }
  initialized = true;

  const port = createMessagePort();
  if (!port) {
    console.error('[Perform6] BSMessagePort missing — XC HDMI relay cannot start');
    return;
  }

  if (runtimeConfig.xcOutputRole === 'primary') {
    port.addEventListener('bsmessage', (event) => {
      if (asString(event.data.type) === LED_READY_MESSAGE) {
        void publishSecondaryScreens(port);
      }
    });

    useRuntimeStore.subscribe((state, previous) => {
      if (state.playbackState.manifest !== previous.playbackState.manifest) {
        void publishSecondaryScreens(port);
      }
    });
    return;
  }

  port.addEventListener('bsmessage', (event) => {
    if (asString(event.data.type) !== PLAYBACK_MESSAGE) return;
    const target = asString(event.data.target);
    if (target && target !== runtimeConfig.xcOutputRole) return;
    void applyLedPlayback(event.data);
  });
  port.PostBSMessage({
    type: LED_READY_MESSAGE,
    role: runtimeConfig.xcOutputRole,
  });
}
