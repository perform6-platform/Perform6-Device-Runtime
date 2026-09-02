import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort, subscribeBsMessages } from './bsMessagePort';
import { findScreenForTarget, getCurrentVideo } from '../services/playback';
import { isLocalPlaybackSrc } from '../services/playbackSrc';
import { resolveSdPlaybackUrl, subscribeSdCacheProgress } from '../services/sdCacheBridge';
import type { DisplayTarget } from '../shared/types';
import { useRuntimeStore } from '../stores/runtimeStore';

const PLAYBACK_MESSAGE = 'xc-playback';
const LED_READY_MESSAGE = 'xc-led-ready';

let initialized = false;
let publishSequence = 0;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Native roVideoPlayer: local SD/file only. Never HTTPS VOD. */
function nativePlayableSrc(src: string | null | undefined): string {
  const value = asString(src);
  return isLocalPlaybackSrc(value) ? value : '';
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
  const cached = mediaVersionId ? resolveSdPlaybackUrl(mediaVersionId, video?.url) : null;
  const src = nativePlayableSrc(cached);

  port.PostBSMessage({
    type: PLAYBACK_MESSAGE,
    role: 'primary',
    target,
    src,
    fallbackSrc: '',
    mediaVersionId,
    mediaTitle: video?.title ?? '',
    screenKey,
    loop: 'true',
    paused: 'false',
    muted: 'false',
    volumePercent: '100',
    restartNonce: '0',
  });
}

async function publishSecondaryScreens(port: BrightSignMessagePort): Promise<void> {
  const sequence = ++publishSequence;
  await postScreenPlayback(port, 'led2', 'SCREEN_2');
  if (sequence !== publishSequence) return;
  await postScreenPlayback(port, 'led3', 'SCREEN_3');
}

/**
 * XC4055: HDMI-1 React publishes SCREEN_2 / SCREEN_3; autorun drives
 * HDMI-2/3 via native roVideoPlayer. Secondary Chromium widgets are gone.
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

  // LED-only roles never run in MULTI anymore (native players). Ignore if present.
  if (runtimeConfig.xcOutputRole !== 'primary') {
    return;
  }

  const port = getSharedMessagePort();
  if (!port) {
    console.error('[Perform6] BSMessagePort missing — XC HDMI relay cannot start');
    return;
  }

  subscribeBsMessages((event) => {
    if (asString(event.data.type) === LED_READY_MESSAGE) {
      void publishSecondaryScreens(port);
    }
  });

  subscribeSdCacheProgress((event) => {
    if (event.status === 'done' || event.status === 'skip') {
      void publishSecondaryScreens(port);
    }
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (state.playbackState.manifest !== previous.playbackState.manifest) {
      void publishSecondaryScreens(port);
    }
  });

  // Publish once if native LED ready beat the listener, or on first paint.
  void publishSecondaryScreens(port);
}
