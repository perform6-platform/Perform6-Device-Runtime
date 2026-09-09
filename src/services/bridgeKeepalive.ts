/**
 * BrightAuthor / docs-style messageport health (optional).
 * LED playback PRIMARY path is SD bus — not this probe.
 * Keepalive: handshake with grace while JS boots after HtmlWidget, then steady ping.
 * Never SetUrl-recycles HTML. Never auto-reboot from pong miss / heal probe.
 * Explicit Admin reboot = led-ota-reboot / requestBridgeForceHeal only.
 */
import {
  getBridgeTransport,
  getSharedMessagePort,
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

/** bridging = boot handshake (HTML up, JS/port still connecting) — not "broken". */
export type BridgeLinkState = 'bridging' | 'up' | 'degraded' | 'down';

/** HtmlWidget often loads before Node messageport + React — wait before declaring down. */
const BRIDGE_GRACE_MS = 45_000;
/** Fast hello while waiting for led-hello-ack. */
const HELLO_RETRY_GRACE_MS = 2_500;
/** Steady hello only if still unpaired after grace. */
const HELLO_RETRY_STEADY_MS = 60_000;
/** Status ping only after handshake (or grace ended). */
const PING_INTERVAL_MS = 60_000;
const PONG_WAIT_MS = 20_000;
const ROUND_TRIP_FRESH_MS = 120_000;
const TICK_FRESH_MS = 120_000;
const HEAVY_LOAD_HOLD_MS = 60_000;
const REBOOT_COOLDOWN_MS = 10 * 60_000;
const REBOOT_MESSAGE = 'led-ota-reboot';

let started = false;
let pingTimer: number | null = null;
let helloTimer: number | null = null;
let graceEndTimer: number | null = null;
let pongWaitTimer: number | null = null;
let unsub: (() => void) | null = null;
let awaitingPong = false;
let missStreak = 0;
let lastRoundTripAt = 0;
let lastAutorunToJsAt = 0;
let lastHeavyLoadAt = 0;
let rebootRequestedAt = 0;
let bridgeState: BridgeLinkState = 'bridging';
let graceStartedAt = 0;
/** True after first HELLO_ACK / PONG (duplex proven once). */
let duplexReady = false;

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

/** Boot window: do not treat missing pong as broken; no recycle/reboot from probe. */
export function isBridgeInGrace(): boolean {
  if (duplexReady) return false;
  if (!started || graceStartedAt <= 0) return true;
  return Date.now() - graceStartedAt < BRIDGE_GRACE_MS;
}

export function isBridgeDuplexReady(): boolean {
  return duplexReady;
}

function graceRemainingMs(): number {
  if (!isBridgeInGrace()) return 0;
  if (graceStartedAt <= 0) return BRIDGE_GRACE_MS;
  return Math.max(0, BRIDGE_GRACE_MS - (Date.now() - graceStartedAt));
}

function computeBridgeState(): BridgeLinkState {
  if (isBridgeInGrace() && lastRoundTripAt === 0) return 'bridging';
  const now = Date.now();
  const rtFresh =
    lastRoundTripAt > 0 && now - lastRoundTripAt < ROUND_TRIP_FRESH_MS;
  if (rtFresh) return 'up';
  if (isBridgeInGrace()) return 'bridging';
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
  const level = next === 'bridging' || next === 'up' ? 'info' : 'warn';
  const line = `[Perform6] Bridge state ${prev} → ${next} (${reason})`;
  if (level === 'info') console.info(line, { duplexReady, graceMs: graceRemainingMs() });
  else console.warn(line, { duplexReady, missStreak });
  if (next === 'down' || next === 'degraded') flushLogsSoon();
}

/**
 * BA-simple stuck recovery: full reboot only.
 * Prefer Node @brightsign/system (works when duplex is dead); also ask autorun.
 */
function requestPlayerReboot(reason: string, force = false): void {
  if (!force && isBridgeInGrace()) {
    console.info('[Perform6] Bridge reboot skipped (handshake grace)', { reason });
    return;
  }
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
  if (source === BridgeMsg.HELLO_ACK || source === BridgeMsg.PONG) {
    if (!duplexReady) {
      duplexReady = true;
      console.info('[Perform6] Bridge duplex ready (handshake complete)', {
        source,
        transport: getBridgeTransport(),
      });
      scheduleHelloRetries();
    }
    console.info('[Perform6] Bridge alive', { source });
  }
  if (busy) noteBridgeHeavyLoad('pong-busy');
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
  if (isBridgeInGrace()) {
    console.info(
      '[Perform6] Bridge pong miss during grace — still handshaking (not broken)',
      {
        graceRemainingMs: graceRemainingMs(),
        transport: getBridgeTransport(),
      },
    );
    publishBridgeState('pong-miss-grace');
    return;
  }
  missStreak += 1;
  // Observe only — never auto-reboot from keepalive. LED uses SD bus.
  if (missStreak <= 2 || missStreak % 5 === 0) {
    console.warn('[Perform6] Bridge pong miss (observe-only; LED uses SD bus)', {
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
  // HTML up ≠ JS port ready — skip ping until hello-ack or grace ends.
  if (isBridgeInGrace() && !duplexReady) return;
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
  if (duplexReady && isAutorunBridgeUp() && lastRoundTripAt > 0) return;
  sendAutorunHello();
}

function scheduleHelloRetries(): void {
  if (helloTimer != null) {
    window.clearInterval(helloTimer);
    helloTimer = null;
  }
  const interval =
    !duplexReady && isBridgeInGrace() ? HELLO_RETRY_GRACE_MS : HELLO_RETRY_STEADY_MS;
  helloTimer = window.setInterval(() => {
    maybeSendHello();
    const want =
      !duplexReady && isBridgeInGrace() ? HELLO_RETRY_GRACE_MS : HELLO_RETRY_STEADY_MS;
    if (want !== interval) scheduleHelloRetries();
  }, interval);
}

export function startBridgeKeepalive(): void {
  if (started) return;
  if (!isBrightSignRuntime()) return;
  const port = getSharedMessagePort();
  if (!port) {
    console.warn('[Perform6] Bridge probe not started — BSMessagePort missing (retry)');
    window.setTimeout(() => {
      if (!started) startBridgeKeepalive();
    }, 2_000);
    return;
  }
  started = true;
  graceStartedAt = Date.now();
  duplexReady = false;
  bridgeState = 'bridging';
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
  console.info('[Perform6] Bridge handshake started (grace + led-hello retry)', {
    graceMs: BRIDGE_GRACE_MS,
    helloRetryMs: HELLO_RETRY_GRACE_MS,
    transport: getBridgeTransport(),
  });
  publishBridgeState('grace-start');

  void probeAutorunCapabilities(BRIDGE_GRACE_MS)
    .then(() => {
      publishBridgeState('hello-probe');
      if (!isAutorunBridgeUp() && !isBridgeInGrace()) flushLogsSoon();
    })
    .catch(() => {
      if (!isBridgeInGrace()) flushLogsSoon();
    });

  scheduleHelloRetries();
  window.setTimeout(() => {
    sendAutorunHello();
  }, 400);

  graceEndTimer = window.setTimeout(() => {
    graceEndTimer = null;
    scheduleHelloRetries();
    if (!duplexReady) {
      console.warn(
        '[Perform6] Bridge grace ended without hello-ack — LED still uses SD bus; not forcing recycle',
        { transport: getBridgeTransport() },
      );
      publishBridgeState('grace-ended');
      sendPing();
    }
  }, BRIDGE_GRACE_MS);

  pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
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
  if (graceEndTimer != null) {
    window.clearTimeout(graceEndTimer);
    graceEndTimer = null;
  }
  clearPongWait();
  unsub?.();
  unsub = null;
  started = false;
  graceStartedAt = 0;
  duplexReady = false;
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
    bridging: state === 'bridging',
    duplexReady,
    graceRemainingMs: graceRemainingMs(),
    missStreak,
    lastRoundTripAt: lastRoundTripAt || null,
    lastAutorunToJsAt: lastAutorunToJsAt || null,
    heavyLoad: isHeavyLoad(),
  };
}

/**
 * Docs-style: messageport health is observe-only.
 * LED uses SD bus — never auto-reboot / SetUrl-recycle from heal probes.
 */
export function requestBridgeSelfHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  console.warn('[Perform6] Bridge heal observe-only (no auto-reboot; LED uses SD bus)', {
    reason,
    grace: isBridgeInGrace(),
  });
  flushLogsSoon();
}

/**
 * @deprecated HTML SetUrl recycle breaks duplex. Docs-style: refuse, no reboot.
 */
export function requestBridgeHtmlRecycle(reason: string, force = false): void {
  if (!isBrightSignRuntime()) return;
  console.warn(
    '[Perform6] Bridge HTML recycle refused (docs-style — no SetUrl, no auto-reboot)',
    { reason, force },
  );
  flushLogsSoon();
}

/** Explicit Admin / ops force path only — not used by keepalive probes. */
export function requestBridgeForceHeal(reason: string): void {
  if (!isBrightSignRuntime()) return;
  requestPlayerReboot(reason, true);
}
