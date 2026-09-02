/**
 * Single BSMessagePort per HtmlWidget — BrightSign delivers PostJSMessage to the
 * first port created; multiple instances drop cache-progress events.
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

/** Lazily create and return the shared port (null in browser / simulator). */
export function getSharedMessagePort(): BrightSignMessagePort | null {
  if (sharedPort !== undefined) return sharedPort;
  sharedPort = null;
  try {
    const ctor = window.BSMessagePort;
    if (typeof ctor !== 'function') return sharedPort;
    const port = new ctor();
    port.addEventListener('bsmessage', (event) => {
      dispatchBsMessage(event);
    });
    sharedPort = port;
  } catch (error) {
    console.warn('[Perform6] BSMessagePort unavailable', error);
  }
  return sharedPort;
}

/** Subscribe to all PostJSMessage events on the shared port. */
export function subscribeBsMessages(
  listener: (event: BrightSignMessagePortEvent) => void,
): () => void {
  getSharedMessagePort();
  bsMessageListeners.add(listener);
  return () => {
    bsMessageListeners.delete(listener);
  };
}
