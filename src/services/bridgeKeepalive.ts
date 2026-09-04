import {
  getSharedMessagePort,
  resetSharedMessagePort,
  subscribeBsMessages,
} from '../platform/bsMessagePort';
import { runtimeConfig } from '../config/runtime';
import {
  getBridgeHealthSnapshot,
  isAutorunBridgeUp,
  noteAutorunRoundTrip,
  probeAutorunCapabilities,
  sendAutorunHello,
} from './autorunCapabilities';
import { BridgeMsg } from './bridgeProtocol';
import { getCredentials } from './credentialStore';
import { flushDeviceLogs } from './deviceLogsApi';

const PING_INTERVAL_MS = 15_000;
const PONG_WAIT_MS = 15_000;
const HELLO_RETRY_MS = 5_000;
const MISS_STREAK_BEFORE_PORT_RESET = 4;
const MISS_STREAK_BEFORE_HEAL = 8;
const PONG_STREAK_HEALTHY = 2;
const HEAL_COOLDOWN_MS = 10 * 60_000;

let started = false;
let pingTimer: number | null = null;
let helloTimer: number | null = null;
let pongWaitTimer: number | null = null;
let unsub: (() => void) | null = null;
let awaitingPong = false;
let missStreak = 0;
let pongStreak = 0;
let healthyAnnounced = false;
let healRequestedAt = 0;
let lastRoundTripAt = 0;
let lastAutorunToJsAt = 0;
let portResetDoneForStreak = false;

function isBrightSignRuntime(): boolean {
  return runtimeConfig.runtimeMode === 'BRIGHTSIGN';
}

function flushLogsSoon(): void {
  const auth = getCredentials();
  if (!auth) return;
  void flushDeviceLogs(auth).catch(() => undefined);
}

function clearPongWait(): void {
  if (pongWaitTimer != null) {
    window.clearTimeout(pongWaitTimer);
    pongWaitTimer = null;
  }
  awaitingPong = false;
}

function requestHeal(reason: string): void {
  const now = Date.now();
  if (healRequestedAt > 0 && now - healRequestedAt < HEAL_COOLDOWN_MS) return;
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Bridge heal skipped — BSMessagePort missing', reason);
    flushLogsSoon();
    return;
  }
  healRequestedAt = now;
  console.warn('[Perform6] Bridge self-heal requested:', reason);
  try {
    port.PostBSMessage({ type: BridgeMsg.HEAL, reason });
  } catch (error) {
    console.warn('[Perform6] Bridge heal PostBSMessage failed', error);
  }
  flushLogsSoon();
}

function announceHealthy(): void {
  if (healthyAnnounced) return;
  const port = getSharedMessagePort();
  if (!port) return;
  healthyAnnounced = true;
  healRequestedAt = 0;
  portResetDoneForStreak = false;
  try {
    port.PostBSMessage({ type: BridgeMsg.HEALTHY });
  } catch {
    /* ignore */
  }
  console.info('[Perform6] Bridge keepalive ok (round-trip)');
  flushLogsSoon();
}

function onRoundTrip(source: string): void {
  clearPongWait();
  missStreak = 0;
  portResetDoneForStreak = false;
  lastRoundTripAt = Date.now();
  lastAutorunToJsAt = lastRoundTripAt;
  pongStreak += 1;
  console.info('[Perform6] Bridge keepalive alive', { source, pongStreak });
  if (pongStreak >= PONG_STREAK_HEALTHY) {
    announceHealthy();
  }
}

function onAutorunToJs(source: string): void {
  lastAutorunToJsAt = Date.now();
  if (source === BridgeMsg.TICK && missStreak > 0) {
    console.info('[Perform6] Bridge autorun→JS tick (JS→autorun still pending)', {
      missStreak,
    });
  }
}

function onPongTimeout(): void {
  awaitingPong = false;
  pongWaitTimer = null;
  pongStreak = 0;
  healthyAnnounced = false;
  missStreak += 1;
  const shouldLog =
    missStreak <= 3 || missStreak % 5 === 0 || missStreak >= MISS_STREAK_BEFORE_HEAL;
  if (shouldLog) {
    console.warn('[Perform6] Bridge keepalive pong miss', {
      missStreak,
      threshold: MISS_STREAK_BEFORE_HEAL,
      lastRoundTripAt: lastRoundTripAt || null,
      lastAutorunToJsAt: lastAutorunToJsAt || null,
    });
    flushLogsSoon();
  }
  sendAutorunHello();
  if (
    missStreak >= MISS_STREAK_BEFORE_PORT_RESET &&
    !portResetDoneForStreak
  ) {
    portResetDoneForStreak = true;
    resetSharedMessagePort();
    sendAutorunHello();
  }
  if (missStreak >= MISS_STREAK_BEFORE_HEAL) {
    requestHeal(`keepalive miss x${missStreak}`);
  }
}

function sendPing(): void {
  let port = getSharedMessagePort();
  if (!port) {
    port = resetSharedMessagePort();
    if (!port) return;
  }
  if (awaitingPong) return;
  awaitingPong = true;
  try {
    port.PostBSMessage({ type: BridgeMsg.PING });
  } catch (error) {
    awaitingPong = false;
    console.warn('[Perform6] Bridge ping PostBSMessage failed', error);
    resetSharedMessagePort();
    flushLogsSoon();
    return;
  }
  pongWaitTimer = window.setTimeout(onPongTimeout, PONG_WAIT_MS);
}

function maybeSendHello(): void {
  if (!isAutorunBridgeUp()) {
    sendAutorunHello();
    return;
  }
  if (lastRoundTripAt > 0 && Date.now() - lastRoundTripAt > 45_000) {
    sendAutorunHello();
  }
}

export function startBridgeKeepalive(): void {
  if (started) return;
  if (!isBrightSignRuntime()) return;
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Bridge keepalive not started — BSMessagePort missing');
    window.setTimeout(() => {
      if (!started) {
        resetSharedMessagePort();
        startBridgeKeepalive();
      }
    }, 3_000);
    return;
  }
  started = true;
  unsub = subscribeBsMessages((event) => {
    const data = event.data ?? {};
    const type = String(data.type ?? '');
    if (noteAutorunRoundTrip(data)) {
      onRoundTrip(type);
      return;
    }
    if (type === BridgeMsg.TICK) {
      onAutorunToJs(type);
    }
  });
  void probeAutorunCapabilities(10_000)
    .then(() => {
      if (!isAutorunBridgeUp()) flushLogsSoon();
    })
    .catch(() => {
      flushLogsSoon();
    });
  helloTimer = window.setInterval(maybeSendHello, HELLO_RETRY_MS);
  window.setTimeout(() => {
    sendAutorunHello();
    sendPing();
  }, 1_000);
  pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
  console.info('[Perform6] Bridge keepalive started', {
    intervalMs: PING_INTERVAL_MS,
    pongWaitMs: PONG_WAIT_MS,
    helloRetryMs: HELLO_RETRY_MS,
  });
}

export function stopBridgeKeepalive(): void {
  if (pingTimer != null) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
  if (helloTimer != null) {
    window.clearInterval(helloTimer);
    helloTimer = null;
  }
  clearPongWait();
  unsub?.();
  unsub = null;
  started = false;
}

export function isBridgeKeepaliveHealthy(): boolean {
  return healthyAnnounced && missStreak === 0;
}

export function getKeepaliveBridgeSnapshot() {
  return {
    ...getBridgeHealthSnapshot(),
    healthy: isBridgeKeepaliveHealthy(),
    missStreak,
    lastRoundTripAt: lastRoundTripAt || null,
  };
}

export function requestBridgeSelfHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  requestHeal(reason);
}
