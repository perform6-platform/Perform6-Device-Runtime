import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort, subscribeBsMessages } from './bsMessagePort';
import { isLocalPlaybackSrc } from '../services/playbackSrc';
import { BridgeMsg } from '../services/bridgeProtocol';
import { subscribeSdCacheProgress } from '../services/sdCacheBridge';
import { useRuntimeStore } from '../stores/runtimeStore';

let initialized = false;
let ignoreLedEndedUntil = 0;
let awaitingAck = false;
let ackTimer: number | null = null;
let lastPostedNonce = '';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nativePlayableSrc(src: string | null | undefined, fallbackSrc: string | null | undefined): string {
  const primary = asString(src);
  const fallback = asString(fallbackSrc);
  if (isLocalPlaybackSrc(primary)) return primary;
  if (isLocalPlaybackSrc(fallback)) return fallback;
  return '';
}

function clearAckWait(): void {
  if (ackTimer != null) {
    window.clearTimeout(ackTimer);
    ackTimer = null;
  }
  awaitingAck = false;
}

function postTouchPlayback(port: BrightSignMessagePort, isRetry = false): void {
  const state = useRuntimeStore.getState();
  const meta = state.displayPlaybackMeta;
  const src = nativePlayableSrc(state.displayVideoSrc, meta?.fallbackSrc);
  const restartNonce = String(state.displayRestartNonce);
  lastPostedNonce = restartNonce;
  port.PostBSMessage({
    type: BridgeMsg.XT_PLAYBACK,
    role: 'touch',
    src,
    fallbackSrc: isLocalPlaybackSrc(asString(meta?.fallbackSrc))
      ? asString(meta?.fallbackSrc)
      : '',
    mediaVersionId: meta?.mediaVersionId ?? '',
    mediaTitle: meta?.title ?? '',
    screenKey: meta?.screenKey ?? 'SCREEN_1',
    loop: state.displayVideoLoop ? 'true' : 'false',
    paused: state.displayPaused ? 'true' : 'false',
    muted: state.displayMuted ? 'true' : 'false',
    volumePercent: String(
      state.displayMuted
        ? 0
        : Math.max(0, Math.min(100, Math.round(state.displayVolume * 100))),
    ),
    restartNonce,
  });
  if (!src) {
    clearAckWait();
    return;
  }
  if (awaitingAck && !isRetry) return;
  awaitingAck = true;
  if (ackTimer != null) window.clearTimeout(ackTimer);
  ackTimer = window.setTimeout(() => {
    awaitingAck = false;
    ackTimer = null;
    console.warn('[Perform6] XT playback ack timeout — retrying once', {
      src,
      restartNonce,
    });
    postTouchPlayback(port, true);
  }, 3_000);
}

export function initXtOutputBridge(): void {
  if (
    initialized ||
    runtimeConfig.isSimulator ||
    runtimeConfig.hardwareProfile !== 'XT2145'
  ) {
    return;
  }
  initialized = true;

  if (runtimeConfig.xtOutputRole === 'led') {
    return;
  }

  const port = getSharedMessagePort();
  if (!port) {
    console.error('[Perform6] BSMessagePort missing — XT HDMI relay cannot start');
    return;
  }

  subscribeBsMessages((event) => {
    const type = asString(event.data.type);
    if (type === BridgeMsg.XT_LED_READY) {
      postTouchPlayback(port);
    } else if (type === BridgeMsg.XT_PLAYBACK_ACK) {
      const nonce = asString(event.data.restartNonce);
      if (!nonce || nonce === lastPostedNonce) {
        clearAckWait();
      }
      const ok = asString(event.data.ok) !== '0';
      if (!ok) {
        console.warn('[Perform6] XT playback ack failed', {
          detail: asString(event.data.detail),
          src: asString(event.data.src),
        });
      }
    } else if (type === BridgeMsg.XT_LED_ENDED) {
      if (Date.now() < ignoreLedEndedUntil) {
        console.info('[Perform6] Ignoring LED ended after restart');
        return;
      }
      useRuntimeStore.getState().displayVideoEndedHandler?.();
    }
  });

  subscribeSdCacheProgress((event) => {
    if (event.status === 'done' || event.status === 'skip') {
      postTouchPlayback(port);
    }
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (state.displayRestartNonce !== previous.displayRestartNonce) {
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

  postTouchPlayback(port);
}
