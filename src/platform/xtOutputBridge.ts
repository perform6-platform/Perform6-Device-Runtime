/**
 * XT2145 LED = native roVideoPlayer zone (Option A / BA-style).
 * PRIMARY: PostBSMessage(xt-playback) → autorun ApplyNativePlayback → PlayFile.
 * RESUME:  SD:/perform6-led-playback.json for boot / one-way bridge backup.
 * src = JS AssetPool getPath (GetPoolFilePath equivalent). No auto-reboot.
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

/** Leaf name for autorun logging / future BRS GetPoolFilePath. */
function assetNameFromSrc(src: string): string {
  const cleaned = src.replace(/^SD:\//i, '').replace(/^\/storage\/sd\//i, '');
  const slash = cleaned.lastIndexOf('/');
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
}

function writeSdResume(
  payload: ReturnType<typeof buildPayload>,
  reason: string,
  force = false,
): void {
  const fileOk = writeXtPlaybackFile(payload, { immediate: true, force });
  console.info('[Perform6] XT LED SD-resume', {
    reason,
    ok: fileOk,
    src: payload.src,
    restartNonce: payload.restartNonce,
  });
}

/**
 * BA zone event first; SD file second (boot resume / bridge down).
 * Never waits on ack. Never reboots.
 */
function postTouchPlayback(port: BrightSignMessagePort | null, force = false): void {
  const payload = buildPayload();
  if (!payload.src) return;

  let posted = false;
  if (port) {
    try {
      port.PostBSMessage(payload);
      posted = true;
      console.info('[Perform6] XT LED zone-primary PostBSMessage', {
        reason: force ? 'reassert' : 'play',
        src: payload.src,
        restartNonce: payload.restartNonce,
      });
    } catch (error) {
      console.warn('[Perform6] XT PostBSMessage failed — SD resume still written', error);
    }
  } else {
    console.warn('[Perform6] BSMessagePort missing — XT LED SD-resume only');
  }

  writeSdResume(payload, posted ? 'resume-after-zone' : 'resume-no-port', force);
}

function buildPayload(): {
  type: string;
  role: string;
  src: string;
  fallbackSrc: string;
  assetName: string;
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
    assetName: assetNameFromSrc(src),
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
  console.info('[Perform6] XT LED zone reassert (no reboot)', {
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
    console.warn('[Perform6] BSMessagePort missing — XT LED uses SD-resume only');
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
          console.info('[Perform6] XT playback ack (zone)', { nonce });
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

  postTouchPlayback(port);
  window.setInterval(() => pollPlaybackStatus(port), 2000);
  console.info('[Perform6] XT LED armed (zone-primary, SD-resume, no auto-reboot)', {
    transport: getBridgeTransport(),
  });
}
