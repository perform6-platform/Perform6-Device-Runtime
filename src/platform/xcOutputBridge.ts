import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort, subscribeBsMessages } from './bsMessagePort';
import { findScreenForTarget, getCurrentVideo } from '../services/playback';
import { isLocalPlaybackSrc } from '../services/playbackSrc';
import { BridgeMsg } from '../services/bridgeProtocol';
import { resolveSdPlaybackUrl, subscribeSdCacheProgress } from '../services/sdCacheBridge';
import type { DisplayTarget } from '../shared/types';
import { useRuntimeStore } from '../stores/runtimeStore';

let initialized = false;
let publishSequence = 0;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

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
    type: BridgeMsg.XC_PLAYBACK,
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

export function initXcOutputBridge(): void {
  if (
    initialized ||
    runtimeConfig.isSimulator ||
    runtimeConfig.hardwareProfile !== 'XC4055'
  ) {
    return;
  }
  initialized = true;

  if (runtimeConfig.xcOutputRole !== 'primary') {
    return;
  }

  const port = getSharedMessagePort();
  if (!port) {
    console.error('[Perform6] BSMessagePort missing — XC HDMI relay cannot start');
    return;
  }

  subscribeBsMessages((event) => {
    const type = asString(event.data.type);
    if (type === BridgeMsg.XC_LED_READY) {
      void publishSecondaryScreens(port);
    } else if (type === BridgeMsg.XC_PLAYBACK_ACK) {
      if (asString(event.data.ok) === '0') {
        console.warn('[Perform6] XC playback ack failed', {
          role: asString(event.data.role),
          detail: asString(event.data.detail),
        });
      }
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

  void publishSecondaryScreens(port);
}
