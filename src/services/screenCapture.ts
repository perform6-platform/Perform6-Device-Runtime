import { runtimeConfig } from '../config/runtime';
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import { getSharedMessagePort } from '../platform/bsMessagePort';
import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import { getCredentials } from './credentialStore';

const JPEG_PATH = toNodeSdPath('SD:/perform6-screen-capture.jpg');
const RESULT_PATH = toNodeSdPath('SD:/perform6-screen-capture-result.json');
const CAPTURE_INTERVAL_MS = 60_000;
const CAPTURE_TIMEOUT_MS = 15_000;
const CAPTURE_WIDTH = 1920;
const CAPTURE_HEIGHT = 720;

let captureInFlight: Promise<boolean> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function requestId(): string {
  return `capture-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function waitForResult(id: string): Promise<boolean> {
  const fs = getNodeFs();
  if (!fs) return false;
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(RESULT_PATH)) {
        const raw = fs.readFileSync(RESULT_PATH, 'utf8');
        const result = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as {
          requestId?: string;
          ok?: boolean;
          fileBytes?: number | string;
        };
        if (result.requestId === id) {
          const fileBytes = Number(result.fileBytes ?? 0);
          return result.ok === true && Number.isFinite(fileBytes) && fileBytes >= 4;
        }
      }
    } catch {
      // Atomic marker may not have arrived yet.
    }
    await sleep(250);
  }
  return false;
}

async function uploadCapture(auth: DeviceAuthContext, id: string): Promise<void> {
  const fs = getNodeFs();
  if (!fs || !fs.existsSync(JPEG_PATH)) throw new Error('capture JPEG missing');
  const raw = fs.readFileSync(JPEG_PATH);
  const bytes = raw instanceof Uint8Array ? raw : new TextEncoder().encode(raw);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('capture JPEG signature invalid');
  }
  const form = new FormData();
  const blobBytes = Uint8Array.from(bytes).buffer;
  form.append('capture', new Blob([blobBytes], { type: 'image/jpeg' }), 'xt2145-output.jpg');
  form.append('requestId', id);
  form.append('capturedAt', new Date().toISOString());
  form.append('width', String(CAPTURE_WIDTH));
  form.append('height', String(CAPTURE_HEIGHT));
  await apiFetchData('/devices/me/screen-capture', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: form,
    timeoutMs: 30_000,
  });
}

export function captureAndUploadXtOutput(reason = 'periodic'): Promise<boolean> {
  if (runtimeConfig.hardwareProfile !== 'XT2145' || runtimeConfig.isSimulator) {
    return Promise.resolve(false);
  }
  if (captureInFlight) return captureInFlight;
  captureInFlight = (async () => {
    const auth = getCredentials();
    const port = getSharedMessagePort();
    if (!auth || !port) return false;
    const id = requestId();
    try {
      port.PostBSMessage({ type: 'p6-screen-capture', requestId: id });
      if (!(await waitForResult(id))) {
        console.warn('[Perform6] Output capture failed', { reason, stage: 'native' });
        return false;
      }
      await uploadCapture(auth, id);
      console.info('[Perform6] Output capture uploaded', { reason, requestId: id });
      return true;
    } catch (error) {
      console.warn('[Perform6] Output capture failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  })().finally(() => {
    captureInFlight = null;
  });
  return captureInFlight;
}

export function startXtOutputCapture(): () => void {
  if (runtimeConfig.hardwareProfile !== 'XT2145' || runtimeConfig.isSimulator) {
    return () => {};
  }
  const first = window.setTimeout(() => void captureAndUploadXtOutput('startup'), 20_000);
  const interval = window.setInterval(
    () => void captureAndUploadXtOutput('periodic'),
    CAPTURE_INTERVAL_MS,
  );
  return () => {
    window.clearTimeout(first);
    window.clearInterval(interval);
  };
}
