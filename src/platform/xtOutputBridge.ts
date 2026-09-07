import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort, subscribeBsMessages } from './bsMessagePort';
import {
  readXtPlaybackStatus,
  writeXtPlaybackFile,
} from './xtPlaybackFile';
import { isNativeLedPlayableSrc, toLedPlayableSrc } from '../services/playbackSrc';
import { BridgeMsg } from '../services/bridgeProtocol';
import { subscribeSdCacheProgress } from '../services/sdCacheBridge';
import { useRuntimeStore } from '../stores/runtimeStore';

let initialized = false;
let ignoreLedEndedUntil = 0;
let lastPostedNonce = '';
let lastStatusEndedNonce = '';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nativePlayableSrc(src: string | null | undefined, fallbackSrc: string | null | undefined): string {
  const primary = toLedPlayableSrc(src);
  if (primary) return primary;
  return toLedPlayableSrc(fallbackSrc);
}

function buildPayload(): {
  type: string;
  role: string;
  src: string;
  fallbackSrc: string;
  mediaVersionId: string;
  mediaTitle: string;
  screenKey: string;
  loop: string;
  paused: string;
  muted: string;
  volumePercent: string;
  restartNonce: string;
} {
  const state = useRuntimeStore.getState();
  const meta = state.displayPlaybackMeta;
  const src = nativePlayableSrc(state.displayVideoSrc, meta?.fallbackSrc);
  const restartNonce = String(state.displayRestartNonce);
  lastPostedNonce = restartNonce;
  return {
    type: BridgeMsg.XT_PLAYBACK,
    role: 'touch',
    src,
    fallbackSrc: toLedPlayableSrc(meta?.fallbackSrc),
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
  };
}

/**
 * Primary path: SD file (autorun polls 500ms). Bridge PostBSMessage is best-effort only.
 */
function postTouchPlayback(port: BrightSignMessagePort | null): void {
  const payload = buildPayload();
  if (!payload.src) {
    return;
  }

  const fileOk = writeXtPlaybackFile(payload, { immediate: true });
  if (fileOk) {
    console.info('[Perform6] XT LED command via SD file (bridge optional)', {
      src: payload.src,
      restartNonce: payload.restartNonce,
    });
  } else {
    console.warn('[Perform6] XT LED SD file write failed — trying bridge only', {
      src: payload.src,
    });
  }

  if (!port) return;
  try {
    port.PostBSMessage(payload);
  } catch (error) {
    console.warn('[Perform6] XT bridge PostBSMessage failed (SD file still written)', error);
  }
}

function pollPlaybackStatus(): void {
  const status = readXtPlaybackStatus();
  if (!status) return;

  if (status.ok === '1' && status.restartNonce === lastPostedNonce) {
    // LED confirmed playing via SD status — no bridge ack needed.
  }

  if (status.ended === '1') {
    const nonce = asString(status.restartNonce);
    if (nonce && nonce === lastStatusEndedNonce) return;
    if (nonce) lastStatusEndedNonce = nonce;
    if (Date.now() < ignoreLedEndedUntil) {
      console.info('[Perform6] Ignoring LED ended (status file) after restart');
      return;
    }
    console.info('[Perform6] LED ended via SD status file');
    useRuntimeStore.getState().displayVideoEndedHandler?.();
  }
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
    console.warn(
      '[Perform6] BSMessagePort missing — XT LED will use SD file bus only',
    );
  } else {
    subscribeBsMessages((event) => {
      const type = asString(event.data.type);
      if (type === BridgeMsg.XT_LED_READY) {
        postTouchPlayback(port);
      } else if (type === BridgeMsg.XT_PLAYBACK_ACK) {
        const nonce = asString(event.data.restartNonce);
        const ok = asString(event.data.ok) !== '0';
        if (ok) {
          console.info('[Perform6] XT playback ack (bridge bonus)', { nonce });
        } else {
          console.warn('[Perform6] XT playback ack failed (bridge)', {
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
  }

  subscribeSdCacheProgress((event) => {
    if (event.status === 'done' || event.status === 'skip') {
      postTouchPlayback(port);
    }
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (state.displayRestartNonce !== previous.displayRestartNonce) {
      ignoreLedEndedUntil = Date.now() + 1500;
      lastStatusEndedNonce = '';
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

  window.setInterval(pollPlaybackStatus, 1000);
  postTouchPlayback(port);
  console.info('[Perform6] XT output bridge armed (SD file primary, messageport optional)');
}
