/**
 * XT2145 LED = video zone in the same autorun "presentation" as touch HtmlWidget.
 * The SD command file is authoritative on XT2145/BOS 9.1; PostBSMessage is an
 * optional low-latency hint. This survives a one-way or blocked widget bridge.
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
import {
  clearScreenPlayback,
  reportScreenPlayback,
} from '../services/playbackTelemetry';
import { useRuntimeStore } from '../stores/runtimeStore';
import { encryptionAssetId } from '../services/mediaEncryption';

const ACK_WAIT_MS = 2_500;
const REASSERT_MS = 5_000;

let initialized = false;
let ignoreLedEndedUntil = 0;
let lastPostedNonce = '';
let lastStatusEndedSignature = '';
let lastReassertAt = 0;
let lastBridgeAckNonce = '';
let ackTimer: number | null = null;
let pendingSdFallback = false;
let nativeTelemetrySignature = '';
let nativeTelemetryStartedAt = 0;
let nativeTelemetryScreenKey = '';

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

function clearAckTimer(): void {
  if (ackTimer != null) {
    window.clearTimeout(ackTimer);
    ackTimer = null;
  }
}

function buildPayload(): {
  type: string;
  role: string;
  src: string;
  fallbackSrc: string;
  mediaVersionId: string;
  encryptionAssetId: string;
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
    encryptionAssetId: encryptionAssetId(meta?.mediaVersionId),
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

function writeSdFallback(
  payload: ReturnType<typeof buildPayload>,
  reason: string,
  force = false,
): void {
  const fileOk = writeXtPlaybackFile(payload, { immediate: true, force });
  const detail = {
    reason,
    ok: fileOk,
    src: payload.src,
    restartNonce: payload.restartNonce,
  };
  if (fileOk) {
    console.info('[Perform6] XT HDMI-2 command persisted (native SD transport)', detail);
  } else {
    console.warn('[Perform6] XT HDMI-2 command persistence failed', detail);
  }
}

/**
 * Native XT playback has no HTMLVideoElement to sample. Mirror the autorun
 * status sidecar into the existing CMS telemetry registry. SCREEN_2 is the
 * physical HDMI-2 output; SCREEN_1 remains the Bluefin touch output.
 */
function reportNativeHdmiTelemetry(status: ReturnType<typeof readXtPlaybackStatus>): void {
  if (!status) return;

  const state = useRuntimeStore.getState();
  const meta = state.displayPlaybackMeta;
  const src = asString(status.src) || nativePlayableSrc(
    state.displayVideoSrc,
    meta?.fallbackSrc,
  );
  if (!src) return;

  const nonce = asString(status.restartNonce) || String(state.displayRestartNonce);
  const signature = `${nonce}|${src}`;
  if (signature !== nativeTelemetrySignature) {
    nativeTelemetrySignature = signature;
    nativeTelemetryStartedAt = Date.now();
  }

  const started = isLedStatusStarted(status);
  const ended = status.ended === '1' || status.state === 'ended';
  const failed = status.state === 'error' || status.ok === '0';
  // XT2145 has two physical outputs. Program slots (Start Here, Phase 1,
  // Phase 2, Full Program) all play through the same LED output and must not
  // be reported as additional screens.
  const screenKey = 'SCREEN_2';
  if (nativeTelemetryScreenKey && nativeTelemetryScreenKey !== screenKey) {
    clearScreenPlayback(nativeTelemetryScreenKey);
  }
  nativeTelemetryScreenKey = screenKey;
  reportScreenPlayback({
    screenKey,
    mediaVersionId: meta?.mediaVersionId ?? null,
    title: meta?.title ?? null,
    positionMs: nativeTelemetryStartedAt > 0 ? Date.now() - nativeTelemetryStartedAt : 0,
    durationMs: null,
    isPlaying: started && !ended && !state.displayPaused,
    output: 'HDMI-2 native (configured 3840x2160x60p)',
    source: 'NATIVE_HDMI',
    requestId: `xt-${nonce}`,
    stage: ended ? 'ended' : (status.state ?? (started ? 'started' : 'pending')),
    error: failed ? (status.detail ?? 'native playback failed') : null,
    path: src,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * BA-style zone message: PostBSMessage first. SD file only if bridge cannot confirm.
 */
function postTouchPlayback(port: BrightSignMessagePort | null, force = false): void {
  const payload = buildPayload();
  if (!payload.src) return;

  pendingSdFallback = false;
  clearAckTimer();

  // Persist before touching the widget bridge. Autorun polls this file every
  // two seconds, independently of the optional HtmlWidget message channel.
  writeSdFallback(payload, 'authoritative-sd-command', force);

  if (!port) {
    return;
  }

  try {
    port.PostBSMessage(payload);
    console.info('[Perform6] XT LED zone via bridge (BA-style)', {
      src: payload.src,
      restartNonce: payload.restartNonce,
      transport: getBridgeTransport(),
      force,
    });
  } catch (error) {
    console.warn('[Perform6] XT PostBSMessage failed — SD fallback', error);
    writeSdFallback(payload, 'post-failed', force);
    return;
  }

  // Observe acknowledgement for diagnostics; the command is already durable.
  pendingSdFallback = true;
  const nonce = payload.restartNonce;
  ackTimer = window.setTimeout(() => {
    ackTimer = null;
    if (!pendingSdFallback) return;
    if (lastBridgeAckNonce === nonce) return;
    if (isLedStatusStarted(readXtPlaybackStatus())) {
      pendingSdFallback = false;
      return;
    }
    writeSdFallback(payload, 'ack-timeout', true);
    pendingSdFallback = false;
  }, ACK_WAIT_MS);
}

function pollPlaybackStatus(port: BrightSignMessagePort | null): void {
  const status = readXtPlaybackStatus();
  const bus = readXtBusHeartbeat();
  reportNativeHdmiTelemetry(status);

  if (status?.ended === '1') {
    const nonce = asString(status.restartNonce);
    const endedSignature = `${nonce}|${asString(status.src)}|${asString(status.wantUrl)}`;
    if (endedSignature === lastStatusEndedSignature) return;
    lastStatusEndedSignature = endedSignature;
    if (Date.now() < ignoreLedEndedUntil) {
      console.info('[Perform6] Ignoring LED ended (status file) after restart');
      return;
    }
    console.info('[Perform6] LED media-ended event received via SD status');
    useRuntimeStore.getState().displayVideoEndedHandler?.();
    return;
  }

  const state = useRuntimeStore.getState();
  const want = nativePlayableSrc(
    state.displayVideoSrc,
    state.displayPlaybackMeta?.fallbackSrc,
  );
  if (!want) return;
  if (lastBridgeAckNonce === lastPostedNonce) return;
  if (isLedStatusStarted(status)) return;

  const now = Date.now();
  if (now - lastReassertAt < REASSERT_MS) return;
  lastReassertAt = now;
  console.info('[Perform6] XT LED reassert (BA bridge primary)', {
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
    console.warn(
      '[Perform6] BSMessagePort missing — XT LED uses SD fallback only',
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
          lastBridgeAckNonce = nonce || lastPostedNonce;
          pendingSdFallback = false;
          clearAckTimer();
          console.info('[Perform6] XT playback ack (BA bridge)', { nonce });
        } else {
          console.warn('[Perform6] XT playback ack failed (bridge)', {
            detail: asString(event.data.detail),
            src: asString(event.data.src),
          });
          const payload = buildPayload();
          if (payload.src) writeSdFallback(payload, 'ack-failed', true);
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

  window.addEventListener('perform6-encrypted-media-ready', () => {
    // Re-emit the current command only after the encrypted derivative is
    // durably downloaded and realized. The native preflight preserves the
    // prior source if registry readback is unavailable.
    postTouchPlayback(port, true);
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (state.displayRestartNonce !== previous.displayRestartNonce) {
      ignoreLedEndedUntil = Date.now() + 1500;
      lastStatusEndedSignature = '';
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

  window.setInterval(() => pollPlaybackStatus(port), 1000);
  postTouchPlayback(port);
  console.info(
    '[Perform6] XT output bridge armed (BA-style: PostBSMessage primary, SD fallback)',
    { transport: getBridgeTransport() },
  );
}
