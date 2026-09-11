/**
 * Field probe for 4K60 HDMI output vs HTML/LED playback.
 * Console lines are uploaded to Admin device logs (prefix OUTPUT|).
 */
import { runtimeConfig } from '../config/runtime';
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';

const EXPECTED_W = 3840;
const EXPECTED_H = 2160;
const WATCH_MS = 60_000;
const DIAG_PATHS = ['SD:/perform6-output-diag.json', '/storage/sd/perform6-output-diag.json'];

let started = false;
let lastSignature = '';

type OutputDiag = {
  type?: string;
  profile?: string;
  mode?: string;
  colorspace?: string;
  colordepth?: string;
  fps?: string;
  ok4k60?: string;
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

function widgetLooks4k(): boolean {
  return window.innerWidth >= EXPECTED_W - 8 && window.innerHeight >= EXPECTED_H - 8;
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
  const widgetOk = widgetLooks4k();
  const diag = readOutputDiag();
  const decode = htmlVideoSummary();
  const mode = diag?.mode || 'missing';
  const fps = diag?.fps || '';
  const depth = diag?.colordepth || '';
  const hdmiOk = diag?.ok4k60 === '1';
  const profile = runtimeConfig.hardwareProfile;
  const signature = [reason, widget, mode, fps, depth, decode, String(widgetOk), String(hdmiOk)].join('|');
  if (signature === lastSignature && reason !== 'boot') return;
  lastSignature = signature;

  console.info(
    `[Perform6] OUTPUT|BLUEFIN|widget=${widget}|ok=${widgetOk ? 1 : 0}|profile=${profile}|reason=${reason}`,
  );
  if (diag) {
    console.info(
      `[Perform6] OUTPUT|HDMI|mode=${mode}|fps=${fps}|depth=${depth}|colorspace=${diag.colorspace || ''}|ok4k60=${diag.ok4k60 || '0'}|profile=${diag.profile || profile}`,
    );
  } else {
    console.warn('[Perform6] OUTPUT|ISSUE|perform6-output-diag.json missing — autorun HDMI mode not confirmed');
  }

  if (decode !== 'none') {
    console.info(`[Perform6] OUTPUT|HTML_VIDEO|decode=${decode}|widget=${widget}`);
  }

  if (profile === 'XT2145' || profile === 'XC4055') {
    console.info(
      `[Perform6] OUTPUT|LED|native=roVideoPlayer|expected=${EXPECTED_W}x${EXPECTED_H}|confirm=OUT|RECT + PlayFile in autorun log`,
    );
  }

  if (!widgetOk) {
    console.warn(
      `[Perform6] OUTPUT|ISSUE|HTML widget below 4K|${widget}|expected=${EXPECTED_W}x${EXPECTED_H}`,
    );
  }
  if (diag && !hdmiOk) {
    console.warn(
      `[Perform6] OUTPUT|ISSUE|HDMI output not 4K60|mode=${mode}|fps=${fps}|depth=${depth}`,
    );
  }
  if (widgetOk && hdmiOk) {
    console.info('[Perform6] OUTPUT|OK|Bluefin widget and HDMI mode are 4K60');
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
