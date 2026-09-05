/**
 * BrightSign allows one BSMessagePort per HtmlWidget.
 * Recreating the port drops autorun→JS replies onto a dead instance.
 */
let sharedPort: BrightSignMessagePort | null | undefined;
const bsMessageListeners = new Set<(event: BrightSignMessagePortEvent) => void>();

function dispatchBsMessage(event: BrightSignMessagePortEvent): void {
  for (const listener of bsMessageListeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[Perform6] BSMessagePort listener error', error);
    }
  }
}

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const ctor = window.BSMessagePort;
    if (typeof ctor !== 'function') {
      console.warn('[Perform6] BSMessagePort constructor missing');
      return null;
    }
    const port = new ctor();
    port.addEventListener('bsmessage', (event) => {
      dispatchBsMessage(event);
    });
    console.info('[Perform6] BSMessagePort ready (single instance)');
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

/** Docs: one port per widget. Never construct a second instance. */
export function resetSharedMessagePort(): BrightSignMessagePort | null {
  if (sharedPort) {
    console.warn(
      '[Perform6] BSMessagePort reset ignored — keeping the boot instance',
    );
    return sharedPort;
  }
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
