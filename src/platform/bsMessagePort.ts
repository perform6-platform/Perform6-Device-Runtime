/**
 * BrightSign / BrightAuthor: one BSMessagePort per HtmlWidget = normal zone messaging.
 * Recreating the port drops autorun→JS replies onto a dead instance.
 *
 * This application is a nodejs_enabled widget. Its field-proven control
 * object is @brightsign/messageport; playback, OTA and reboot all share it.
 * BrightSign allows only one BSMessagePort instance per roHtmlWidget, so never
 * create a browser-global observer beside this object.
 */
let sharedPort: BrightSignMessagePort | null | undefined;
const bsMessageListeners = new Set<(event: BrightSignMessagePortEvent) => void>();

export type BridgeTransport = 'node-messageport' | 'dom-bsmessageport' | 'none';
let activeTransport: BridgeTransport = 'none';
let inboundCallbackObserved = false;

export function getBridgeTransport(): BridgeTransport {
  return activeTransport;
}

/** True when inbound PostJSMessage is expected to work (BA-style duplex). */
export function isBridgeDuplexTransport(): boolean {
  return inboundCallbackObserved;
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
 * Field versions 1.5.23-1.5.42 prove that this Node object carries outbound
 * playback and OTA commands on the XT2145. The browser-global class is only a
 * fallback for widgets where the Node module is unavailable.
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
  // The Node module delivers the AA itself. Some legitimate messages may
  // contain a field named `data`, so a top-level protocol discriminator must
  // win over DOM-style unwrapping.
  if (
    arg &&
    typeof arg === 'object' &&
    'type' in (arg as Record<string, unknown>)
  ) {
    return { data: arg as Record<string, unknown> };
  }
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

function bindInbound(
  port: BrightSignMessagePort,
  transport: 'node-messageport' | 'dom-bsmessageport',
): void {
  // Keep duplicate suppression for DOM fallbacks that may surface the same
  // event through both callback styles. The official Node path binds once.
  let lastDispatchAt = 0;
  let lastType = '';
  let callbackSeen = false;
  const onMsg = (raw: unknown) => {
    if (!callbackSeen) {
      callbackSeen = true;
      inboundCallbackObserved = true;
      try {
        console.info('[Perform6] BRIDGE|RECEIVE|callback-entered=1');
      } catch { /* diagnostics must not interrupt message dispatch */ }
    }
    const event = normalizeInbound(raw);
    const type = String(event?.data?.type ?? '');
    const now = Date.now();
    if (type && type === lastType && now - lastDispatchAt < 15) return;
    lastType = type;
    lastDispatchAt = now;
    dispatchBsMessage(event);
  };
  let listenerRegistration = transport === 'dom-bsmessageport' ? 'skipped-dom-standard' : 'missing';
  let propertyAssignment = transport === 'node-messageport' ? 'skipped-node-standard' : 'missing';
  // Use one exact, documented receiving surface per constructor. BrightSign's
  // browser-global example uses onbsmessage; its Node-enabled cookbook uses
  // addEventListener('bsmessage'). Mixing both on one native instance makes a
  // field failure ambiguous and can replace a single native callback slot.
  if (transport === 'dom-bsmessageport') {
    try {
      (port as BrightSignMessagePort & { onbsmessage?: (event: unknown) => void }).onbsmessage =
        onMsg;
      propertyAssignment = 'returned';
    } catch {
      propertyAssignment = 'threw';
    }
  } else {
    try {
      if (typeof port.addEventListener === 'function') {
        port.addEventListener('bsmessage', onMsg);
        listenerRegistration = 'returned';
      }
    } catch {
      listenerRegistration = 'threw';
    }
  }
  // A call returning without throwing is not proof of delivery or duplex.
  try {
    console.info('[Perform6] BRIDGE|LISTENER', {
      listenerRegistration,
      propertyAssignment,
      delivery: 'unconfirmed',
    });
  } catch { /* diagnostics must not invalidate a working port */ }
}

function createMessagePort(): BrightSignMessagePort | null {
  try {
    // Preserve the field-proven control surface for every outbound
    // playback/OTA/reboot command and construct exactly one port.
    const NodeCtor = resolveNodeMessagePortCtor();
    if (NodeCtor) {
      try {
        const port = new NodeCtor();
        bindInbound(port, 'node-messageport');
        activeTransport = 'node-messageport';
        console.info('[Perform6] BSMessagePort ready (Node control; inbound unconfirmed)');
        return port;
      } catch (error) {
        console.warn(
          '[Perform6] Node control port construct failed — trying DOM-only fallback',
          error,
        );
      }
    }

    // Compatibility fallback for non-Node widgets only.
    const DomCtor = window.BSMessagePort;
    if (typeof DomCtor === 'function') {
      const port = new DomCtor();
      bindInbound(port, 'dom-bsmessageport');
      activeTransport = 'dom-bsmessageport';
      console.warn('[Perform6] BSMessagePort ready (DOM-only fallback)');
      return port;
    }

    console.warn('[Perform6] BSMessagePort constructors missing');
    return null;
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
