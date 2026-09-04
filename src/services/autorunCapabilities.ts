import {
  getSharedMessagePort,
  subscribeBsMessages,
} from '../platform/bsMessagePort';
import { runtimeConfig } from '../config/runtime';
import {
  AUTORUN_PROTOCOL_VERSION,
  BridgeMsg,
} from './bridgeProtocol';

export const AUTORUN_PROTOCOL_MIN_OTA = AUTORUN_PROTOCOL_VERSION;

export interface AutorunCapabilities {
  protocolVersion: number;
  features: string[];
  probedAt: number | null;
  autorunRelease: string | null;
}

let caps: AutorunCapabilities = {
  protocolVersion: 0,
  features: [],
  probedAt: null,
  autorunRelease: null,
};

let helloInFlight = false;
let lastHelloSentAt = 0;
let mismatchLogged = false;

function parseProtocol(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function applyAck(data: Record<string, unknown>): void {
  const protocolVersion = parseProtocol(data.protocolVersion);
  const features = String(data.features ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const autorunRelease =
    data.autorunRelease != null ? String(data.autorunRelease) : caps.autorunRelease;
  caps = {
    protocolVersion: protocolVersion || AUTORUN_PROTOCOL_VERSION,
    features: features.length ? features : caps.features,
    probedAt: Date.now(),
    autorunRelease,
  };
  console.info('[Perform6] Autorun hello ack', caps);
  if (
    autorunRelease &&
    autorunRelease !== runtimeConfig.runtimeVersion &&
    !mismatchLogged
  ) {
    mismatchLogged = true;
    console.warn(
      '[Perform6] JS/autorun version skew — flash full package (autorun.brs + index.html + assets)',
      {
        js: runtimeConfig.runtimeVersion,
        autorun: autorunRelease,
      },
    );
  }
}

export function getAutorunCapabilities(): Readonly<AutorunCapabilities> {
  return caps;
}

export function getBridgeHealthSnapshot(): {
  up: boolean;
  protocolVersion: number;
  autorunRelease: string | null;
  jsVersion: string;
  probedAt: number | null;
} {
  return {
    up: caps.protocolVersion >= 1,
    protocolVersion: caps.protocolVersion,
    autorunRelease: caps.autorunRelease,
    jsVersion: runtimeConfig.runtimeVersion,
    probedAt: caps.probedAt,
  };
}

export function autorunSupportsOtaBridge(): boolean {
  return caps.protocolVersion >= AUTORUN_PROTOCOL_MIN_OTA;
}

export function isAutorunBridgeUp(): boolean {
  return caps.protocolVersion >= 1;
}

export function noteAutorunRoundTrip(
  data: Record<string, unknown>,
): boolean {
  const type = String(data.type ?? '');
  if (type === BridgeMsg.HELLO_ACK) {
    applyAck(data);
    return true;
  }
  if (type === BridgeMsg.PONG) {
    if (data.protocolVersion != null) applyAck(data);
    else if (caps.protocolVersion < 1) {
      caps = {
        protocolVersion: AUTORUN_PROTOCOL_VERSION,
        features: caps.features,
        probedAt: Date.now(),
        autorunRelease: caps.autorunRelease,
      };
    } else {
      caps = { ...caps, probedAt: Date.now() };
    }
    return true;
  }
  return false;
}

export function sendAutorunHello(): boolean {
  if (runtimeConfig.runtimeMode !== 'BRIGHTSIGN') return true;
  const port = getSharedMessagePort();
  if (!port) return false;
  const now = Date.now();
  if (helloInFlight && now - lastHelloSentAt < 2_000) return false;
  helloInFlight = true;
  lastHelloSentAt = now;
  try {
    const ok = port.PostBSMessage({
      type: BridgeMsg.HELLO,
      runtimeVersion: runtimeConfig.runtimeVersion,
      protocolVersion: String(AUTORUN_PROTOCOL_VERSION),
    });
    console.info('[Perform6] Autorun hello sent', {
      ok: ok !== false,
      runtimeVersion: runtimeConfig.runtimeVersion,
    });
    return ok !== false;
  } catch (error) {
    console.warn('[Perform6] Autorun hello PostBSMessage failed', error);
    return false;
  } finally {
    window.setTimeout(() => {
      helloInFlight = false;
    }, 1_500);
  }
}

export async function probeAutorunCapabilities(
  timeoutMs = 10_000,
): Promise<AutorunCapabilities> {
  if (runtimeConfig.runtimeMode !== 'BRIGHTSIGN') {
    caps = {
      protocolVersion: AUTORUN_PROTOCOL_MIN_OTA,
      features: ['simulator'],
      probedAt: Date.now(),
      autorunRelease: 'simulator',
    };
    return caps;
  }

  const port = getSharedMessagePort();
  if (!port) {
    caps = {
      protocolVersion: 0,
      features: [],
      probedAt: Date.now(),
      autorunRelease: null,
    };
    console.warn('[Perform6] Autorun hello skipped — BSMessagePort missing');
    return caps;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(caps);
    };

    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (noteAutorunRoundTrip(data) && caps.protocolVersion >= 1) {
        finish();
      }
    });

    const timer = window.setTimeout(() => {
      if (caps.protocolVersion < 1) {
        caps = {
          protocolVersion: 0,
          features: [],
          probedAt: Date.now(),
          autorunRelease: null,
        };
        console.warn(
          '[Perform6] Autorun bridge down — no led-hello-ack within ' +
            String(timeoutMs) +
            'ms. Flash full SD package (autorun.brs + index.html + assets) matching JS v' +
            runtimeConfig.runtimeVersion,
        );
      }
      finish();
    }, timeoutMs);

    sendAutorunHello();
  });
}
