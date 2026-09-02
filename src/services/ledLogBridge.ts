import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';

const LOG_TAIL_REQUEST = 'led-log-tail-request';
const LOG_TAIL_RESPONSE = 'led-log-tail';

export async function fetchAutorunLogTail(timeoutMs = 10_000): Promise<string> {
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
