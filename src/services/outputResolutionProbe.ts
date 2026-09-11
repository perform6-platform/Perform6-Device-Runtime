/**
 * Field probe for 4K60 HDMI output vs HTML/LED playback.
 * Console lines are uploaded to Admin device logs (prefix OUTPUT|).
 */
import { runtimeConfig } from '../config/runtime';
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';

const BLUEFIN_W = 1920;
const BLUEFIN_H = 1080;
const LED_W = 3840;
const LED_H = 2160;
const WATCH_MS = 60_000;
const DIAG_PATHS = ['SD:/perform6-output-diag.json', '/storage/sd/perform6-output-diag.json'];

let started = false;
let lastSignature = '';

type OutputDiag = {
  type?: string;
  profile?: string;
  primaryMode?: string;
  bluefinMode?: string;
  ledMode?: string;
  ledEdidBest?: string;
  colorspace?: string;
  colordepth?: string;
  fps?: string;
  configured4k60?: string;
  outputHealthy?: string;
};

function readOutputDiag(): OutputDiag | null {
  const fs = getNodeFs();
  if (!fs) return null;
  for (const sd of DIAG_PATHS) {
    try {
      const nodePath = toNodeSdPath(sd);
      if (!fs.existsSync(nodePath)) continue;
      const raw = fs.readFileSync(nodePath, 'utf8');
      const text = (typeof raw === 'string' ? raw : String(raw)).trim();
      if (!text) continue;
      return JSON.parse(text) as OutputDiag;
    } catch {
      /* try next path */
    }
  }
  return null;
}

function widgetLooksExpected(profile: string): boolean {
  const expectedW = profile === 'XT2145' ? BLUEFIN_W : LED_W;
  const expectedH = profile === 'XT2145' ? BLUEFIN_H : LED_H;
  return window.innerWidth >= expectedW - 8 && window.innerHeight >= expectedH - 8;
}

function htmlVideoSummary(): string {
  if (typeof document === 'undefined') return 'none';
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return 'none';
  return videos
    .slice(0, 4)
    .map((video, index) => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      const ready = video.readyState;
      return `${index}:${w}x${h}:rs${ready}`;
    })
    .join(',');
}

function probeOnce(reason: string): void {
  const widget = `${window.innerWidth}x${window.innerHeight}`;
  const profile = runtimeConfig.hardwareProfile;
  const widgetOk = widgetLooksExpected(profile);
  const diag = readOutputDiag();
  const decode = htmlVideoSummary();
  const primaryMode = diag?.primaryMode || 'missing';
  const ledMode = diag?.ledMode || 'missing';
  const fps = diag?.fps || '';
  const depth = diag?.colordepth || '';
  const hdmiOk = diag?.outputHealthy === '1';
  const signature = [reason, widget, primaryMode, ledMode, fps, depth, decode, String(widgetOk), String(hdmiOk)].join('|');
  if (signature === lastSignature && reason !== 'boot') return;
  lastSignature = signature;

  console.info(
    `[Perform6] OUTPUT|BLUEFIN|widget=${widget}|ok=${widgetOk ? 1 : 0}|profile=${profile}|reason=${reason}`,
  );
  if (diag) {
    console.info(
      `[Perform6] OUTPUT|HDMI-2|configuredMode=${ledMode}|edidBest=${diag.ledEdidBest || 'unknown'}|refresh=${fps}|outputHealthy=${diag.outputHealthy || '0'}|configured4k60=${diag.configured4k60 || '0'}|canvas=${primaryMode}|primaryDepth=${depth}|primaryColorspace=${diag.colorspace || ''}|profile=${diag.profile || profile}`,
    );
  } else {
    console.warn('[Perform6] OUTPUT|ISSUE|perform6-output-diag.json missing — autorun HDMI mode not confirmed');
  }

  if (decode !== 'none') {
    console.info(`[Perform6] OUTPUT|HTML_VIDEO|decode=${decode}|widget=${widget}`);
  }

  if (profile === 'XT2145' || profile === 'XC4055') {
    console.info(
      `[Perform6] OUTPUT|LED|native=roVideoPlayer|configuredMode=${ledMode}|confirm=OUT|CONFIG + OUT|RECT + PlayFile in autorun log`,
    );
  }

  if (!widgetOk) {
    console.warn(
      `[Perform6] OUTPUT|ISSUE|HTML widget unexpected|${widget}|expected=${profile === 'XT2145' ? `${BLUEFIN_W}x${BLUEFIN_H}` : `${LED_W}x${LED_H}`}`,
    );
  }
  if (diag && !hdmiOk) {
    console.warn(
      `[Perform6] OUTPUT|ISSUE|HDMI-2 output unhealthy|mode=${ledMode}|refresh=${fps}|edidBest=${diag.ledEdidBest || 'unknown'}`,
    );
  }
  if (widgetOk && hdmiOk) {
    console.info(
      `[Perform6] OUTPUT|OK|Bluefin widget healthy and HDMI-2 EDID-compatible|mode=${ledMode}|4k60=${diag?.configured4k60 || '0'}`,
    );
  }
}

export function startOutputResolutionProbe(): void {
  if (started || runtimeConfig.isSimulator) return;
  started = true;
  probeOnce('boot');
  window.setInterval(() => probeOnce('watch'), WATCH_MS);
  document.addEventListener(
    'loadedmetadata',
    (event) => {
      if (event.target instanceof HTMLVideoElement) probeOnce('video-meta');
    },
    true,
  );
}
