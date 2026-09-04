import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';

const LOG_TAIL_REQUEST = 'led-log-tail-request';
const LOG_TAIL_RESPONSE = 'led-log-tail';
const LOG_PATH = 'SD:/perform6-led.log';
const MAX_CHARS = 48_000;

function readAutorunLogViaNode(): string {
  const fs = getNodeFs();
  if (!fs) return '';
  const nodePath = toNodeSdPath(LOG_PATH);
  try {
    if (!fs.existsSync(nodePath)) return '';
    const raw = fs.readFileSync(nodePath, 'utf8');
    const text = typeof raw === 'string' ? raw : String(raw);
    if (text.length <= MAX_CHARS) return text;
    return text.slice(-MAX_CHARS);
  } catch (error) {
    console.warn('[Perform6] Node autorun log read failed', error);
    return '';
  }
}

async function fetchAutorunLogTailViaBridge(timeoutMs: number): Promise<string> {
  const port = getSharedMessagePort();
  if (!port) return '';

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(text);
    };

    const unsub = subscribeBsMessages((event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== LOG_TAIL_RESPONSE) return;
      if (String(data.requestId ?? '') !== requestId) return;
      finish(String(data.text ?? ''));
    });

    const timer = window.setTimeout(() => finish(''), timeoutMs);

    try {
      port.PostBSMessage({ type: LOG_TAIL_REQUEST, requestId });
    } catch {
      finish('');
    }
  });
}

export async function fetchAutorunLogTail(timeoutMs = 4_000): Promise<string> {
  const viaNode = readAutorunLogViaNode();
  if (viaNode.trim()) {
    console.info('[Perform6] Autorun log tail via Node', {
      chars: viaNode.length,
    });
    return viaNode;
  }
  const viaBridge = await fetchAutorunLogTailViaBridge(timeoutMs);
  if (viaBridge.trim()) {
    console.info('[Perform6] Autorun log tail via bridge', {
      chars: viaBridge.length,
    });
  } else {
    console.warn('[Perform6] Autorun log tail empty (Node+bridge)');
  }
  return viaBridge;
}
