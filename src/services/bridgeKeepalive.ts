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

export type BridgeLinkState = 'up' | 'degraded' | 'down';

const PING_INTERVAL_MS = 15_000;
const PONG_WAIT_MS = 15_000;
const PONG_WAIT_BUSY_MS = 30_000;
const HELLO_RETRY_MS = 5_000;
const HEAVY_LOAD_HOLD_MS = 60_000;
const ROUND_TRIP_FRESH_MS = 45_000;
const TICK_FRESH_MS = 45_000;

const MISS_PORT_RESET = 3;
const MISS_HTML_RECYCLE = 5;
const MISS_HEAL_REBOOT = 8;
const HEAL_COOLDOWN_MS = 10 * 60_000;
const RECYCLE_COOLDOWN_MS = 15 * 60_000;
const PONG_STREAK_HEALTHY = 2;

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
let recycleRequestedAt = 0;
let lastRoundTripAt = 0;
let lastAutorunToJsAt = 0;
let lastHeavyLoadAt = 0;
let portResetDoneForStreak = false;
let recycleDoneForStreak = false;
let bridgeState: BridgeLinkState = 'down';

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

function isHeavyLoad(): boolean {
  return lastHeavyLoadAt > 0 && Date.now() - lastHeavyLoadAt < HEAVY_LOAD_HOLD_MS;
}

export function noteBridgeHeavyLoad(source = 'transfer'): void {
  lastHeavyLoadAt = Date.now();
  if (source) {
    /* quiet — high frequency during downloads */
  }
}

function computeBridgeState(): BridgeLinkState {
  const now = Date.now();
  const rtFresh =
    lastRoundTripAt > 0 && now - lastRoundTripAt < ROUND_TRIP_FRESH_MS;
  if (rtFresh && missStreak === 0) return 'up';
  const tickFresh =
    lastAutorunToJsAt > 0 && now - lastAutorunToJsAt < TICK_FRESH_MS;
  if (tickFresh && !rtFresh) return 'degraded';
  if (rtFresh) return 'up';
  return 'down';
}

function publishBridgeState(reason: string): void {
  const next = computeBridgeState();
  if (next === bridgeState) return;
  const prev = bridgeState;
  bridgeState = next;
  console.warn('[Perform6] Bridge state', { from: prev, to: next, reason });
  flushLogsSoon();
}

function requestHtmlRecycle(reason: string, force = false): void {
  const now = Date.now();
  if (
    !force &&
    recycleRequestedAt > 0 &&
    now - recycleRequestedAt < RECYCLE_COOLDOWN_MS
  ) {
    return;
  }
  const port = getSharedMessagePort();
  if (!port) return;
  recycleRequestedAt = now;
  console.warn('[Perform6] Bridge html recycle requested:', reason);
  try {
    port.PostBSMessage({
      type: BridgeMsg.RECYCLE,
      reason,
      force: force ? '1' : '0',
    });
  } catch (error) {
    console.warn('[Perform6] Bridge recycle PostBSMessage failed', error);
  }
  flushLogsSoon();
}

function requestHeal(reason: string, force = false): void {
  const now = Date.now();
  if (!force && healRequestedAt > 0 && now - healRequestedAt < HEAL_COOLDOWN_MS) {
    return;
  }
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Bridge heal skipped — BSMessagePort missing', reason);
    flushLogsSoon();
    return;
  }
  healRequestedAt = now;
  console.warn('[Perform6] Bridge self-heal requested:', reason, { force });
  try {
    port.PostBSMessage({
      type: BridgeMsg.HEAL,
      reason,
      force: force ? '1' : '0',
    });
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
  recycleDoneForStreak = false;
  try {
    port.PostBSMessage({ type: BridgeMsg.HEALTHY });
  } catch {
    /* ignore */
  }
  console.info('[Perform6] Bridge keepalive ok (round-trip)');
  publishBridgeState('healthy');
  flushLogsSoon();
}

function onRoundTrip(source: string, busy = false): void {
  clearPongWait();
  missStreak = 0;
  portResetDoneForStreak = false;
  recycleDoneForStreak = false;
  lastRoundTripAt = Date.now();
  lastAutorunToJsAt = lastRoundTripAt;
  if (busy) noteBridgeHeavyLoad('pong-busy');
  pongStreak += 1;
  console.info('[Perform6] Bridge keepalive alive', {
    source,
    pongStreak,
    busy,
  });
  if (pongStreak >= PONG_STREAK_HEALTHY) {
    announceHealthy();
  } else {
    publishBridgeState(source);
  }
}

function onAutorunToJs(source: string, busy = false): void {
  lastAutorunToJsAt = Date.now();
  if (busy) noteBridgeHeavyLoad('tick-busy');
  publishBridgeState(source);
  if (source === BridgeMsg.TICK && missStreak > 0) {
    console.info('[Perform6] Bridge degraded — autorun→JS only', {
      missStreak,
    });
  }
}

function escalateMiss(reason: string): void {
  sendAutorunHello();
  if (missStreak >= MISS_PORT_RESET && !portResetDoneForStreak) {
    portResetDoneForStreak = true;
    resetSharedMessagePort();
    sendAutorunHello();
    console.warn('[Perform6] Bridge ladder: port reset', { missStreak });
  }
  if (missStreak >= MISS_HTML_RECYCLE && !recycleDoneForStreak) {
    recycleDoneForStreak = true;
    requestHtmlRecycle(reason);
    console.warn('[Perform6] Bridge ladder: html recycle', { missStreak });
  }
  if (missStreak >= MISS_HEAL_REBOOT) {
    if (isHeavyLoad()) {
      console.warn(
        '[Perform6] Bridge ladder: heal deferred (active transfer)',
        { missStreak },
      );
      return;
    }
    requestHeal(reason);
  }
}

function onPongTimeout(): void {
  awaitingPong = false;
  pongWaitTimer = null;
  pongStreak = 0;
  healthyAnnounced = false;
  missStreak += 1;
  const shouldLog =
    missStreak <= 3 ||
    missStreak % 5 === 0 ||
    missStreak >= MISS_HEAL_REBOOT;
  if (shouldLog) {
    console.warn('[Perform6] Bridge keepalive pong miss', {
      missStreak,
      state: computeBridgeState(),
      heavyLoad: isHeavyLoad(),
      lastRoundTripAt: lastRoundTripAt || null,
      lastAutorunToJsAt: lastAutorunToJsAt || null,
    });
    flushLogsSoon();
  }
  publishBridgeState('pong-miss');
  escalateMiss(`keepalive miss x${missStreak}`);
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
  const waitMs = isHeavyLoad() ? PONG_WAIT_BUSY_MS : PONG_WAIT_MS;
  pongWaitTimer = window.setTimeout(onPongTimeout, waitMs);
}

function maybeSendHello(): void {
  if (!isAutorunBridgeUp() || bridgeState !== 'up') {
    sendAutorunHello();
    return;
  }
  if (lastRoundTripAt > 0 && Date.now() - lastRoundTripAt > ROUND_TRIP_FRESH_MS) {
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
    const busy = String(data.busy ?? '') === '1';
    if (
      type === BridgeMsg.CACHE_PROGRESS ||
      type === BridgeMsg.OTA_PROGRESS
    ) {
      noteBridgeHeavyLoad(type);
    }
    if (noteAutorunRoundTrip(data)) {
      onRoundTrip(type, busy);
      return;
    }
    if (type === BridgeMsg.TICK || type === BridgeMsg.RECYCLE_ACK) {
      onAutorunToJs(type, busy);
    }
  });
  void probeAutorunCapabilities(10_000)
    .then(() => {
      publishBridgeState('hello-probe');
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
  console.info('[Perform6] Bridge keepalive started (recovery ladder)', {
    intervalMs: PING_INTERVAL_MS,
    pongWaitMs: PONG_WAIT_MS,
    ladder: [MISS_PORT_RESET, MISS_HTML_RECYCLE, MISS_HEAL_REBOOT],
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
  return bridgeState === 'up' && missStreak === 0;
}

export function getBridgeLinkState(): BridgeLinkState {
  return computeBridgeState();
}

export function getKeepaliveBridgeSnapshot() {
  const state = computeBridgeState();
  bridgeState = state;
  return {
    ...getBridgeHealthSnapshot(),
    healthy: state === 'up' && missStreak === 0,
    bridgeState: state,
    missStreak,
    lastRoundTripAt: lastRoundTripAt || null,
    lastAutorunToJsAt: lastAutorunToJsAt || null,
    heavyLoad: isHeavyLoad(),
  };
}

export function requestBridgeSelfHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  requestHeal(reason, false);
}

export function requestBridgeHtmlRecycle(reason: string, force = false): void {
  if (!isBrightSignRuntime()) return;
  requestHtmlRecycle(reason, force);
}

export function requestBridgeForceHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  requestHeal(reason, true);
}
