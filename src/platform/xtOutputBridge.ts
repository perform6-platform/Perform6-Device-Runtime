/**
 * XT2145 LED = native roVideoPlayer in autorun.
 * PRIMARY: write SD:/perform6-led-playback.json (autorun polls).
 * OPTIONAL: PostBSMessage if port exists — never wait for ack, never reboot.
 */
import { runtimeConfig } from '../config/runtime';
import {
  getBridgeTransport,
  getSharedMessagePort,
  subscribeBsMessages,
} from './bsMessagePort';
import {
  readXtBusHeartbeat,
  readXtPlaybackStatus,
  writeXtPlaybackFile,
  isLedStatusStarted,
} from './ledPlaybackFile';
import { toLedPlayableSrc } from '../services/playbackSrc';
import { BridgeMsg } from '../services/bridgeProtocol';
import { subscribeSdCacheProgress } from '../services/sdCacheBridge';
import { useRuntimeStore } from '../stores/runtimeStore';

const REASSERT_MS = 15_000;

let initialized = false;
let ignoreLedEndedUntil = 0;
let lastPostedNonce = '';
let lastStatusEndedNonce = '';
let lastReassertAt = 0;
let lastBridgeAckNonce = '';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nativePlayableSrc(
  src: string | null | undefined,
  fallbackSrc: string | null | undefined,
): string {
  const primary = toLedPlayableSrc(src);
  if (primary) return primary;
  return toLedPlayableSrc(fallbackSrc);
}

function writeSdPrimary(
  payload: ReturnType<typeof buildPayload>,
  reason: string,
  force = false,
): void {
  const fileOk = writeXtPlaybackFile(payload, { immediate: true, force });
  console.info('[Perform6] XT LED SD-primary', {
    reason,
    ok: fileOk,
    src: payload.src,
    restartNonce: payload.restartNonce,
  });
}

/** SD file first so autorun can PlayFile without a live bridge. */
function postTouchPlayback(port: BrightSignMessagePort | null, force = false): void {
  const payload = buildPayload();
  if (!payload.src) return;

  writeSdPrimary(payload, force ? 'reassert' : 'play', force);

  if (!port) return;
  try {
    port.PostBSMessage(payload);
  } catch (error) {
    console.warn('[Perform6] XT PostBSMessage failed (SD already written)', error);
  }
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

function pollPlaybackStatus(port: BrightSignMessagePort | null): void {
  const status = readXtPlaybackStatus();
  const bus = readXtBusHeartbeat();

  if (status?.ended === '1') {
    const nonce = asString(status.restartNonce);
    if (nonce && nonce === lastStatusEndedNonce) return;
    if (nonce) lastStatusEndedNonce = nonce;
    if (Date.now() < ignoreLedEndedUntil) {
      console.info('[Perform6] Ignoring LED ended (status file) after restart');
      return;
    }
    console.info('[Perform6] LED ended via SD status file');
    useRuntimeStore.getState().displayVideoEndedHandler?.();
    return;
  }

  const state = useRuntimeStore.getState();
  const want = nativePlayableSrc(
    state.displayVideoSrc,
    state.displayPlaybackMeta?.fallbackSrc,
  );
  if (!want) return;
  if (isLedStatusStarted(status) && asString(status?.src) === want) return;

  const now = Date.now();
  if (now - lastReassertAt < REASSERT_MS) return;
  lastReassertAt = now;
  console.info('[Perform6] XT LED SD reassert (no reboot)', {
    status: status?.state ?? null,
    detail: status?.detail ?? null,
    bus: bus?.detail ?? null,
  });
  postTouchPlayback(port, true);
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
    console.warn('[Perform6] BSMessagePort missing — XT LED uses SD file only');
  } else {
    subscribeBsMessages((event) => {
      const type = asString(event.data.type);
      if (type === BridgeMsg.XT_LED_READY) {
        postTouchPlayback(port);
      } else if (type === BridgeMsg.XT_PLAYBACK_ACK) {
        const nonce = asString(event.data.restartNonce);
        const ok = asString(event.data.ok) !== '0';
        if (ok) {
          lastBridgeAckNonce = nonce || lastPostedNonce;
          console.info('[Perform6] XT playback ack (optional bridge)', { nonce });
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
      lastBridgeAckNonce = '';
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

  window.setInterval(() => pollPlaybackStatus(port), 2000);
  postTouchPlayback(port);
  console.info('[Perform6] XT LED armed (SD-primary, bridge optional, no auto-reboot)', {
    transport: getBridgeTransport(),
  });
}
