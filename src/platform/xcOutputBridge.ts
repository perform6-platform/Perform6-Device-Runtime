/**
 * XC4055 LED2/LED3 = video zones in the same autorun as primary HtmlWidget.
 * BrightAuthor-style: PostBSMessage → autorun PlayFile is the NORMAL path.
 * SD JSON file is fallback only (no port / ack timeout).
 */
import { runtimeConfig } from '../config/runtime';
import {
  getBridgeTransport,
  getSharedMessagePort,
  subscribeBsMessages,
} from './bsMessagePort';
import {
  readLedBusHeartbeat,
  readLedPlaybackStatusForRole,
  writeLedPlaybackFile,
  isLedStatusStarted,
  type LedPlaybackCommand,
  type LedPlaybackTarget,
} from './ledPlaybackFile';
import { findScreenForTarget, getCurrentVideo } from '../services/playback';
import { toLedPlayableSrc } from '../services/playbackSrc';
import { BridgeMsg } from '../services/bridgeProtocol';
import { resolveSdPlaybackUrl, subscribeSdCacheProgress } from '../services/sdCacheBridge';
import type { DisplayTarget } from '../shared/types';
import { useRuntimeStore } from '../stores/runtimeStore';

const ACK_WAIT_MS = 2_500;
const REASSERT_MS = 5_000;

let initialized = false;
let publishSequence = 0;
let lastReassertAt = 0;
let lastStatusEndedKey = '';
let lastBridgeAckAt = 0;
let ackTimer: number | null = null;
let pendingSdFallback = false;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nativePlayableSrc(src: string | null | undefined): string {
  return toLedPlayableSrc(src);
}

function clearAckTimer(): void {
  if (ackTimer != null) {
    window.clearTimeout(ackTimer);
    ackTimer = null;
  }
}

function buildCommand(
  target: LedPlaybackTarget,
  screenKey: DisplayTarget,
): LedPlaybackCommand | null {
  const manifest = useRuntimeStore.getState().playbackState.manifest;
  const screen = manifest ? findScreenForTarget(manifest, screenKey) : undefined;
  const video = getCurrentVideo(screen);
  const mediaVersionId = video?.id ?? '';
  const cached = mediaVersionId
    ? resolveSdPlaybackUrl(mediaVersionId, video?.url)
    : null;
  const src = nativePlayableSrc(cached);
  if (!src) return null;
  return {
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
    writtenAt: String(Date.now()),
  };
}

function writeSdFallback(cmds: LedPlaybackCommand[], reason: string, force = false): void {
  const fileOk = writeLedPlaybackFile(cmds, { immediate: true, force });
  console.warn('[Perform6] XC LED SD fallback (BA bridge primary)', {
    reason,
    ok: fileOk,
    targets: cmds.map((c) => c.target),
  });
}

function publishSecondaryScreens(
  port: BrightSignMessagePort | null,
  force = false,
): void {
  const sequence = ++publishSequence;
  const cmds: LedPlaybackCommand[] = [];
  const led2 = buildCommand('led2', 'SCREEN_2');
  const led3 = buildCommand('led3', 'SCREEN_3');
  if (led2) cmds.push(led2);
  if (led3) cmds.push(led3);
  if (cmds.length === 0) return;
  if (sequence !== publishSequence && !force) return;

  pendingSdFallback = false;
  clearAckTimer();

  if (!port) {
    writeSdFallback(cmds, 'no-messageport', force);
    return;
  }

  let posted = 0;
  for (const cmd of cmds) {
    try {
      port.PostBSMessage({
        type: BridgeMsg.XC_PLAYBACK,
        role: 'primary',
        target: cmd.target,
        src: cmd.src,
        fallbackSrc: cmd.fallbackSrc,
        mediaVersionId: cmd.mediaVersionId,
        mediaTitle: cmd.mediaTitle,
        screenKey: cmd.screenKey,
        loop: cmd.loop,
        paused: cmd.paused,
        muted: cmd.muted,
        volumePercent: cmd.volumePercent,
        restartNonce: cmd.restartNonce,
      });
      posted += 1;
    } catch (error) {
      console.warn('[Perform6] XC PostBSMessage failed', cmd.target, error);
    }
  }

  if (posted === 0) {
    writeSdFallback(cmds, 'post-failed', force);
    return;
  }

  console.info('[Perform6] XC LED zones via bridge (BA-style)', {
    targets: cmds.map((c) => c.target),
    srcs: cmds.map((c) => c.src),
    transport: getBridgeTransport(),
    force,
  });

  pendingSdFallback = true;
  const snapshot = cmds;
  ackTimer = window.setTimeout(() => {
    ackTimer = null;
    if (!pendingSdFallback) return;
    if (Date.now() - lastBridgeAckAt < ACK_WAIT_MS + 500) {
      pendingSdFallback = false;
      return;
    }
    const s2 = readLedPlaybackStatusForRole('led2');
    const s3 = readLedPlaybackStatusForRole('led3');
    const ok2 = !snapshot.some((c) => c.target === 'led2') || isLedStatusStarted(s2);
    const ok3 = !snapshot.some((c) => c.target === 'led3') || isLedStatusStarted(s3);
    if (ok2 && ok3) {
      pendingSdFallback = false;
      return;
    }
    writeSdFallback(snapshot, 'ack-timeout', true);
    pendingSdFallback = false;
  }, ACK_WAIT_MS);
}

function pollPlaybackStatus(port: BrightSignMessagePort | null): void {
  const statusLed2 = readLedPlaybackStatusForRole('led2');
  const statusLed3 = readLedPlaybackStatusForRole('led3');
  const bus = readLedBusHeartbeat();

  for (const status of [statusLed2, statusLed3]) {
    if (status?.ended === '1') {
      const key = `${asString(status.role)}|${asString(status.restartNonce)}`;
      if (key === lastStatusEndedKey) continue;
      lastStatusEndedKey = key;
    }
  }

  const want2 = buildCommand('led2', 'SCREEN_2');
  const want3 = buildCommand('led3', 'SCREEN_3');
  if (!want2 && !want3) return;

  const led2Ok = !want2 || isLedStatusStarted(statusLed2);
  const led3Ok = !want3 || isLedStatusStarted(statusLed3);
  if (led2Ok && led3Ok) return;
  if (Date.now() - lastBridgeAckAt < REASSERT_MS) return;

  const now = Date.now();
  if (now - lastReassertAt < REASSERT_MS) return;
  lastReassertAt = now;
  console.info('[Perform6] XC LED reassert (BA bridge primary)', {
    led2: statusLed2?.state ?? null,
    led3: statusLed3?.state ?? null,
    bus: bus?.detail ?? null,
  });
  publishSecondaryScreens(port, true);
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
    console.warn(
      '[Perform6] BSMessagePort missing — XC LED uses SD fallback only',
    );
  } else {
    subscribeBsMessages((event) => {
      const type = asString(event.data.type);
      if (type === BridgeMsg.XC_LED_READY) {
        publishSecondaryScreens(port);
      } else if (type === BridgeMsg.XC_PLAYBACK_ACK) {
        if (asString(event.data.ok) === '0') {
          console.warn('[Perform6] XC playback ack failed (bridge)', {
            role: asString(event.data.role),
            detail: asString(event.data.detail),
          });
        } else {
          lastBridgeAckAt = Date.now();
          pendingSdFallback = false;
          clearAckTimer();
          console.info('[Perform6] XC playback ack (BA bridge)', {
            role: asString(event.data.role),
          });
        }
      }
    });
  }

  subscribeSdCacheProgress((event) => {
    if (event.status === 'done' || event.status === 'skip') {
      publishSecondaryScreens(port);
    }
  });

  useRuntimeStore.subscribe((state, previous) => {
    if (state.playbackState.manifest !== previous.playbackState.manifest) {
      publishSecondaryScreens(port);
    }
  });

  window.setInterval(() => pollPlaybackStatus(port), 1000);
  publishSecondaryScreens(port);
  console.info(
    '[Perform6] XC output bridge armed (BA-style: PostBSMessage primary, SD fallback)',
    { transport: getBridgeTransport() },
  );
}
