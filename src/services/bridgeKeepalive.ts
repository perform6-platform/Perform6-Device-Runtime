/**
 * BrightAuthor-simple bridge health.
 * Touch → LED uses one BSMessagePort + PostBSMessage (xt-playback).
 * Keepalive only probes duplex — never recreates the port or SetUrl-recycles HTML.
 * Stuck recovery (Admin / OTA) = full player reboot only (market pattern).
 */
import {
  getBridgeTransport,
  getSharedMessagePort,
  resetSharedMessagePort,
  subscribeBsMessages,
} from '../platform/bsMessagePort';
import { rebootViaBrightSignSystem } from '../platform/brightSignNode';
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

/** Status ping only — no recovery ladder. */
const PING_INTERVAL_MS = 60_000;
const PONG_WAIT_MS = 20_000;
/** Hello only until first ack. */
const HELLO_RETRY_MS = 60_000;
const ROUND_TRIP_FRESH_MS = 120_000;
const TICK_FRESH_MS = 120_000;
const HEAVY_LOAD_HOLD_MS = 60_000;
const REBOOT_COOLDOWN_MS = 10 * 60_000;
const REBOOT_MESSAGE = 'led-ota-reboot';

let started = false;
let pingTimer: number | null = null;
let helloTimer: number | null = null;
let pongWaitTimer: number | null = null;
let unsub: (() => void) | null = null;
let awaitingPong = false;
let missStreak = 0;
let lastRoundTripAt = 0;
let lastAutorunToJsAt = 0;
let lastHeavyLoadAt = 0;
let rebootRequestedAt = 0;
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

export function noteBridgeHeavyLoad(_source = 'transfer'): void {
  lastHeavyLoadAt = Date.now();
}

function computeBridgeState(): BridgeLinkState {
  const now = Date.now();
  const rtFresh =
    lastRoundTripAt > 0 && now - lastRoundTripAt < ROUND_TRIP_FRESH_MS;
  if (rtFresh) return 'up';
  const tickFresh =
    lastAutorunToJsAt > 0 && now - lastAutorunToJsAt < TICK_FRESH_MS;
  if (tickFresh) return 'degraded';
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

/**
 * BA-simple stuck recovery: full reboot only.
 * Prefer Node @brightsign/system (works when duplex is dead); also ask autorun.
 */
function requestPlayerReboot(reason: string, force = false): void {
  const now = Date.now();
  if (
    !force &&
    rebootRequestedAt > 0 &&
    now - rebootRequestedAt < REBOOT_COOLDOWN_MS
  ) {
    console.warn('[Perform6] Bridge reboot skipped (cooldown)', { reason });
    return;
  }
  rebootRequestedAt = now;
  console.warn('[Perform6] Bridge recovery reboot (BA-simple)', { reason, force });
  const nodeOk = rebootViaBrightSignSystem();
  const port = getSharedMessagePort();
  let autorunOk = false;
  if (port) {
    try {
      port.PostBSMessage({ type: REBOOT_MESSAGE, reason });
      autorunOk = true;
    } catch (error) {
      console.warn('[Perform6] Bridge reboot PostBSMessage failed', error);
    }
  }
  if (!nodeOk && !autorunOk) {
    console.warn('[Perform6] Bridge reboot failed — no Node system and no autorun port', {
      reason,
    });
  }
  flushLogsSoon();
}

function onRoundTrip(source: string, busy = false): void {
  clearPongWait();
  missStreak = 0;
  lastRoundTripAt = Date.now();
  lastAutorunToJsAt = lastRoundTripAt;
  if (busy) noteBridgeHeavyLoad('pong-busy');
  if (source === BridgeMsg.HELLO_ACK || source === BridgeMsg.PONG) {
    console.info('[Perform6] Bridge alive', { source });
  }
  publishBridgeState(source);
}

function onAutorunToJs(source: string, busy = false): void {
  lastAutorunToJsAt = Date.now();
  if (busy) noteBridgeHeavyLoad('tick-busy');
  publishBridgeState(source);
}

function onPongTimeout(): void {
  awaitingPong = false;
  pongWaitTimer = null;
  missStreak += 1;
  // Observe only — never auto-reboot from keepalive (caused boot loops when
  // inbound was on Node @brightsign/messageport while JS listened on DOM).
  // Recovery: Admin REBOOT / power cycle only. Never SetUrl / port recreate.
  if (missStreak <= 2 || missStreak % 5 === 0) {
    console.warn('[Perform6] Bridge pong miss (no auto-reboot)', {
      missStreak,
      state: computeBridgeState(),
      lastRoundTripAt: lastRoundTripAt || null,
      transport: getBridgeTransport(),
    });
    flushLogsSoon();
  }
  publishBridgeState('pong-miss');
}

function sendPing(): void {
  const port = getSharedMessagePort();
  if (!port) return;
  if (awaitingPong) return;
  awaitingPong = true;
  try {
    port.PostBSMessage({ type: BridgeMsg.PING });
  } catch (error) {
    awaitingPong = false;
    console.warn('[Perform6] Bridge ping PostBSMessage failed', error);
    return;
  }
  pongWaitTimer = window.setTimeout(onPongTimeout, PONG_WAIT_MS);
}

function maybeSendHello(): void {
  if (isAutorunBridgeUp() && lastRoundTripAt > 0) return;
  sendAutorunHello();
}

export function startBridgeKeepalive(): void {
  if (started) return;
  if (!isBrightSignRuntime()) return;
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Bridge probe not started — BSMessagePort missing');
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
  console.info('[Perform6] Bridge probe started (Node messageport duplex; no auto-reboot)', {
    pingIntervalMs: PING_INTERVAL_MS,
    transport: getBridgeTransport(),
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

/** Admin / OTA — BA-simple: full reboot only (never SetUrl / port recreate). */
export function requestBridgeSelfHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  requestPlayerReboot(reason, false);
}

/**
 * @deprecated HTML SetUrl recycle breaks duplex. Maps to full reboot (BA-simple).
 */
export function requestBridgeHtmlRecycle(reason: string, force = false): void {
  if (!isBrightSignRuntime()) return;
  console.warn(
    '[Perform6] Bridge HTML recycle disabled (BA-simple) — rebooting instead',
    { reason },
  );
  requestPlayerReboot(reason, force);
}

export function requestBridgeForceHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  requestPlayerReboot(reason, true);
}
