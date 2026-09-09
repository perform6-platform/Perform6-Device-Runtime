/**
 * BrightSign / BrightAuthor: one BSMessagePort per HtmlWidget = normal zone messaging.
 * Recreating the port drops autorun→JS replies onto a dead instance.
 *
 * On nodejs_enabled widgets, duplex requires @brightsign/messageport (Node).
 * DOM BSMessagePort can PostBSMessage but often never receives PostJSMessage.
 */
let sharedPort: BrightSignMessagePort | null | undefined;
const bsMessageListeners = new Set<(event: BrightSignMessagePortEvent) => void>();

export type BridgeTransport = 'node-messageport' | 'dom-bsmessageport' | 'none';
let activeTransport: BridgeTransport = 'none';

export function getBridgeTransport(): BridgeTransport {
  return activeTransport;
}

/** True when inbound PostJSMessage is expected to work (BA-style duplex). */
export function isBridgeDuplexTransport(): boolean {
  return activeTransport === 'node-messageport';
}

function dispatchBsMessage(event: BrightSignMessagePortEvent): void {
  for (const listener of bsMessageListeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[Perform6] BSMessagePort listener error', error);
    }
  }
}

/**
 * autorun `roHtmlWidget.PostJSMessage()` and the DOM `window.BSMessagePort`
 * `bsmessage` event are NOT the same channel on a Node-enabled HtmlWidget.
 * When `nodejs_enabled` is set on the widget (this app requires it for
 * `@brightsign/assetpool`, `@brightsign/system`, …) inbound BrightScript→JS
 * messages are delivered to the Node `@brightsign/messageport` object only.
 * The DOM `BSMessagePort` can still `PostBSMessage` (JS→autorun) but never
 * fires `bsmessage`/`onbsmessage` — the classic "outbound ok, zero pongs,
 * lastRoundTripAt=null" one-way bridge. So resolve the Node port first and
 * fall back to the DOM ctor only when `require` is unavailable (browser /
 * simulator / non-Node widget).
 */
function resolveNodeMessagePortCtor(): (new () => BrightSignMessagePort) | null {
  try {
    const g = globalThis as { require?: (id: string) => unknown };
    if (typeof g.require !== 'function') return null;
    const mod = g.require('@brightsign/messageport') as
      | (new () => BrightSignMessagePort)
      | { MessagePort?: new () => BrightSignMessagePort; default?: new () => BrightSignMessagePort }
      | undefined;
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod.MessagePort === 'function') return mod.MessagePort;
    if (mod && typeof mod.default === 'function') return mod.default;
  } catch {
    /* Node module unavailable — expected off-device */
  }
  return null;
}

/** Node MessagePort passes the raw AA; DOM passes an event with `.data`. */
function normalizeInbound(arg: unknown): BrightSignMessagePortEvent {
  if (
    arg &&
    typeof arg === 'object' &&
    'data' in (arg as Record<string, unknown>) &&
    typeof (arg as { data?: unknown }).data === 'object' &&
    (arg as { data?: unknown }).data !== null
  ) {
    return arg as BrightSignMessagePortEvent;
  }
  return { data: (arg ?? {}) as Record<string, unknown> };
}

function bindInbound(port: BrightSignMessagePort): void {
  // Some OS builds fire both addEventListener('bsmessage') and onbsmessage
  // for one message — dedupe by type within a short window.
  let lastDispatchAt = 0;
  let lastType = '';
  const onMsg = (raw: unknown) => {
    const event = normalizeInbound(raw);
    const type = String(event?.data?.type ?? '');
    const now = Date.now();
    if (type && type === lastType && now - lastDispatchAt < 15) return;
    lastType = type;
    lastDispatchAt = now;
    dispatchBsMessage(event);
  };
  try {
    if (typeof port.addEventListener === 'function') {
      port.addEventListener('bsmessage', onMsg);
    }
  } catch {
    /* not supported on this port variant */
  }
  try {
    (port as BrightSignMessagePort & { onbsmessage?: (event: unknown) => void }).onbsmessage =
      onMsg;
  } catch {
    /* older OS may not allow assignment */
  }
}

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const NodeCtor = resolveNodeMessagePortCtor();
    if (NodeCtor) {
      try {
        const port = new NodeCtor();
        bindInbound(port);
        activeTransport = 'node-messageport';
        console.info('[Perform6] BSMessagePort ready (Node @brightsign/messageport — duplex)');
        return port;
      } catch (error) {
        console.warn(
          '[Perform6] Node @brightsign/messageport construct failed — falling back to DOM',
          error,
        );
      }
    }

    const ctor = window.BSMessagePort;
    if (typeof ctor !== 'function') {
      console.warn('[Perform6] BSMessagePort constructor missing');
      return null;
    }
    const port = new ctor();
    bindInbound(port);
    activeTransport = 'dom-bsmessageport';
    if (NodeCtor == null) {
      console.info('[Perform6] BSMessagePort ready (DOM — no Node require)');
    } else {
      console.warn(
        '[Perform6] BSMessagePort ready (DOM fallback) — inbound autorun→JS may be one-way on a Node widget',
      );
    }
    return port;
  } catch (error) {
    console.warn('[Perform6] BSMessagePort unavailable', error);
    return null;
  }
}

export function getSharedMessagePort(): BrightSignMessagePort | null {
  if (sharedPort !== undefined) return sharedPort;
  sharedPort = createMessagePort();
  return sharedPort;
}

/**
 * BrightSign / BrightAuthor-simple: one message port per HtmlWidget.
 * Recreating the port after a live instance often breaks autorun→JS duplex
 * while PostBSMessage still returns success (hello ok:true, zero pongs).
 * Only create when we never obtained a port.
 */
export function resetSharedMessagePort(): BrightSignMessagePort | null {
  if (sharedPort) {
    console.warn(
      '[Perform6] BSMessagePort reset skipped — recreating breaks duplex',
    );
    return sharedPort;
  }
  sharedPort = undefined;
  return getSharedMessagePort();
}

export function subscribeBsMessages(
  listener: (event: BrightSignMessagePortEvent) => void,
): () => void {
  getSharedMessagePort();
  bsMessageListeners.add(listener);
  return () => {
    bsMessageListeners.delete(listener);
  };
}
