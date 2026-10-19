#!/usr/bin/env node
/**
 * Deterministic visual audit for a shipped XT2145 release ZIP.
 *
 * Important boundaries:
 * - Extracts and serves the ZIP bytes; it never rebuilds source or edits the package.
 * - Seeds only the browser's persisted device/content state.
 * - Fulfils Perform6 API calls locally, so the audit cannot write to production.
 * - Drives the real packaged React controls to reach every UI state.
 * - Captures at the Bluefin logical canvas: 1920x1080, DPR 1.
 *
 * Usage:
 *   node scripts/capture-bluefin-package-ui.mjs \
 *     --zip releases/xt2145/perform6-xt2145-1.5.74.zip \
 *     --out /tmp/perform6-bluefin-1.5.74
 *
 * Playwright resolution order:
 *   1. local `playwright` package
 *   2. PLAYWRIGHT_MODULE_PATH
 *   3. Codex bundled runtime (developer-machine fallback)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const VIEWPORT = Object.freeze({ width: 1920, height: 1080 });
const DEFAULT_ZIP = path.join(
  repoRoot,
  'releases',
  'xt2145',
  'perform6-xt2145-1.5.74.zip',
);

function parseArgs(argv) {
  const args = {
    zip: DEFAULT_ZIP,
    out: '',
    headed: false,
    browser: '',
    keepExtracted: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--zip') args.zip = argv[++i] ?? '';
    else if (token === '--out') args.out = argv[++i] ?? '';
    else if (token === '--browser') args.browser = argv[++i] ?? '';
    else if (token === '--headed') args.headed = true;
    else if (token === '--keep-extracted') args.keepExtracted = true;
    else if (token === '--help' || token === '-h') {
      console.log(`Usage: node scripts/capture-bluefin-package-ui.mjs [options]

Options:
  --zip <path>       Shipped XT2145 ZIP (default: 1.5.74 release ZIP)
  --out <path>       Audit output directory (default: system temp)
  --browser <path>   Browser executable override
  --headed           Show the browser while capturing
  --keep-extracted   Preserve the temporary extracted package
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  args.zip = path.resolve(repoRoot, args.zip);
  return args;
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.mp4': 'video/mp4',
    }[ext] ?? 'application/octet-stream'
  );
}

function findPackageRoot(extractRoot) {
  const candidates = [
    extractRoot,
    ...fs
      .readdirSync(extractRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(extractRoot, entry.name)),
  ];
  const root = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'index.html')),
  );
  if (!root) throw new Error('ZIP does not contain a package root with index.html');
  return root;
}

function startStaticServer(packageRoot) {
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const requested = path.resolve(packageRoot, relative);
      const safe = requested === packageRoot || requested.startsWith(`${packageRoot}${path.sep}`);

      let file = safe && fs.existsSync(requested) && fs.statSync(requested).isFile()
        ? requested
        : path.join(packageRoot, 'index.html');

      response.writeHead(200, {
        'Content-Type': mimeType(file),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not resolve visual-audit server address'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

function findCodexPlaywright() {
  const roots = [
    path.join(os.homedir(), '.cache', 'codex-runtimes'),
    path.join(os.homedir(), '.codex'),
  ];
  const queue = roots.filter((candidate) => fs.existsSync(candidate));
  let visited = 0;
  while (queue.length > 0 && visited < 4_000) {
    const current = queue.shift();
    visited += 1;
    const direct = path.join(current, 'node_modules', 'playwright');
    if (fs.existsSync(path.join(direct, 'package.json'))) return direct;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') && current !== roots[0] && current !== roots[1]) continue;
      const next = path.join(current, entry.name);
      if (next.split(path.sep).length - current.split(path.sep).length > 8) continue;
      queue.push(next);
    }
  }
  return null;
}

function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_MODULE_PATH,
    findCodexPlaywright(),
  ].filter(Boolean);

  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Playwright is required. Run \"npm install --save-dev playwright\" or set ` +
      `PLAYWRIGHT_MODULE_PATH. Attempts:\n${errors.join('\n')}`,
  );
}

const MEDIA = Object.freeze({
  'touch-default': {
    id: 'visual-default',
    title: 'Default — Visual Audit',
    fileUrl: 'https://visual-audit.invalid/default.mp4',
  },
  'start-here': {
    id: 'visual-start-here',
    title: 'Start Here — Visual Audit',
    fileUrl: 'https://visual-audit.invalid/start-here.mp4',
  },
  phase1: {
    id: 'visual-phase-1',
    title: 'Phase 1 — Visual Audit',
    fileUrl: 'https://visual-audit.invalid/phase-1.mp4',
  },
  phase2: {
    id: 'visual-phase-2',
    title: 'Phase 2 — Visual Audit',
    fileUrl: 'https://visual-audit.invalid/phase-2.mp4',
  },
  'full-program': {
    id: 'visual-full-program',
    title: 'Full Program — Visual Audit',
    fileUrl: 'https://visual-audit.invalid/full-program.mp4',
  },
});

function slot(label, media) {
  return {
    label,
    isRotating: false,
    items: [
      {
        video: media.title,
        mediaVersionId: media.id,
        fileUrl: media.fileUrl,
      },
    ],
  };
}

const SYNC_DATA = Object.freeze({
  syncJobId: 'visual-audit-sync',
  device: {
    id: 'visual-audit-device',
    currentRotationDay: 1,
  },
  deployment: {
    deploymentType: 'TOUCH_SCREEN',
    fieldCategory: 'Golf',
    exerciseVariant: 'No Wall',
  },
  playbackManifest: {
    deviceId: 'visual-audit-device',
    deploymentType: 'TOUCH_SCREEN',
    field: 'Golf',
    variant: 'No Wall',
    rotationDay: 1,
    content: {
      default: slot('Default', MEDIA['touch-default']),
      startHere: slot('Start Here', MEDIA['start-here']),
      phase1: slot('Phase 1', MEDIA.phase1),
      phase2: slot('Phase 2', MEDIA.phase2),
      fullProgram: slot('Full Program', MEDIA['full-program']),
    },
  },
  media: [],
  requiredMedia: [],
  retainMediaVersionIds: Object.values(MEDIA).map((media) => media.id),
  evictMediaVersionIds: [],
  runtime: {
    version: '1.5.74',
    updateAvailable: false,
  },
});

function runtimeManifest() {
  return {
    version: SYNC_DATA.syncJobId,
    updatedAt: '2026-10-10T00:00:00.000Z',
    deployment: {
      id: SYNC_DATA.device.id,
      name: 'TOUCH_SCREEN',
      libraryId: 'Golf',
      libraryName: 'Default',
      currentDay: 1,
      totalDays: 36,
    },
    screens: Object.entries(MEDIA).map(([id, media]) => ({
      id,
      label: media.title,
      currentVideo: {
        id: media.id,
        type: 'video',
        url: media.fileUrl,
        title: media.title,
      },
      playlist: [
        {
          id: media.id,
          type: 'video',
          url: media.fileUrl,
          title: media.title,
        },
      ],
      rotationDay: 1,
    })),
  };
}

function persistedStateFixture() {
  const ready = Object.fromEntries(
    Object.values(MEDIA).map((media) => [media.id, media.fileUrl]),
  );
  const ids = Object.values(MEDIA).map((media) => media.id);
  return {
    'perform6-device': JSON.stringify({
      state: {
        pairingId: 'visual-audit-pairing',
        deviceId: 'visual-audit-device',
        apiToken: 'visual-audit-token',
        pairingCode: null,
        registrationStatus: 'registered',
        hasCredentials: true,
      },
      version: 2,
    }),
    'perform6-playback-manifest': JSON.stringify({
      savedAt: '2026-10-10T00:00:00.000Z',
      manifest: runtimeManifest(),
    }),
    'perform6-sd-cache-ready': JSON.stringify(ready),
    'perform6-sd-cache-confirmed': JSON.stringify(ids),
    'perform6-cached-media-ids': JSON.stringify(ids),
    'perform6-media-pool-paths-ver': '3-storage-sd',
  };
}

async function installApiIsolation(page) {
  await page.route('https://portal.perform6.com/api/v1**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
        body: '',
      });
      return;
    }

    const url = new URL(request.url());
    let data = {};
    if (url.pathname.endsWith('/sync/check')) data = SYNC_DATA;
    else if (url.pathname.endsWith('/devices/me/heartbeat')) {
      data = { success: true, remoteCommands: [] };
    } else if (url.pathname.endsWith('/devices/me/logs')) {
      data = { accepted: 0 };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        success: true,
        data,
        timestamp: '2026-10-10T00:00:00.000Z',
      }),
    });
  });
}

async function waitForUi(page) {
  await page.waitForSelector('#p6-bluefin-frame', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.p6-home__start-here:not(:disabled)', {
    state: 'visible',
    timeout: 20_000,
  });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.evaluate(() => {
    const label = document.querySelector('.p6-home__divider .p6-section-divider__label');
    if (!(label instanceof HTMLElement)) return;
    const letterSpacing = getComputedStyle(label).letterSpacing.trim();
    if (!letterSpacing.endsWith('%')) return;

    /*
     * XT2145/DWS calibration from Gabe's 1.5.76 device capture:
     * desktop Chromium rasterizes the legacy `3.5%` declaration at 431px,
     * while DWS captures the same packaged label at 527px. A calibrated
     * 5.603px value reproduces the DWS pixel bounds in the audit browser;
     * this affects simulator rendering only and never alters the ZIP.
     */
    label.style.letterSpacing = '5.603px';
    label.dataset.p6BrightSignTextCalibration = 'xt2145-dws-1.5.76';
  });
  await page.waitForTimeout(350);
}

async function openOverview(page, cardLabel) {
  await page.getByRole('button', { name: cardLabel, exact: true }).click();
  await page.waitForSelector('.p6-session-modal[role="dialog"]', {
    state: 'visible',
    timeout: 5_000,
  });
}

async function beginSession(page, cardLabel) {
  await openOverview(page, cardLabel);
  await page.getByRole('button', { name: /BEGIN SESSION/i }).click();
  await page.waitForSelector('.p6-video-playing-modal[role="dialog"]', {
    state: 'visible',
    timeout: 5_000,
  });
}

const STATES = Object.freeze([
  {
    id: '00-home',
    label: 'Home',
    enter: async () => {},
  },
  {
    id: '01-start-here-begin',
    label: 'Start Here — Begin Session',
    enter: (page) => openOverview(page, 'Start Here'),
  },
  {
    id: '02-start-here-return',
    label: 'Start Here — Return to Menu',
    enter: (page) => beginSession(page, 'Start Here'),
  },
  {
    id: '03-phase-1-begin',
    label: 'Phase 1 — Begin Session',
    enter: (page) => openOverview(page, 'Phase 1'),
  },
  {
    id: '04-phase-1-return',
    label: 'Phase 1 — Return to Menu',
    enter: (page) => beginSession(page, 'Phase 1'),
  },
  {
    id: '05-phase-2-begin',
    label: 'Phase 2 — Begin Session',
    enter: (page) => openOverview(page, 'Phase 2'),
  },
  {
    id: '06-phase-2-return',
    label: 'Phase 2 — Return to Menu',
    enter: (page) => beginSession(page, 'Phase 2'),
  },
  {
    id: '07-full-program-begin',
    label: 'Full Program — Begin Session',
    enter: (page) => openOverview(page, 'Full Program'),
  },
  {
    id: '08-full-program-playing',
    label: 'Full Program — Playing',
    enter: (page) => beginSession(page, 'Full Program'),
  },
  {
    id: '09-full-program-paused',
    label: 'Full Program — Paused',
    enter: async (page) => {
      await beginSession(page, 'Full Program');
      await page.getByRole('button', { name: 'PAUSE', exact: true }).click();
      await page.getByRole('button', { name: 'RESUME', exact: true }).waitFor();
    },
  },
  {
    id: '10-full-program-restart-confirm',
    label: 'Full Program — Restart Confirmation',
    enter: async (page) => {
      await beginSession(page, 'Full Program');
      await page.getByRole('button', { name: 'RESTART', exact: true }).click();
      await page.getByText('Restart Session?', { exact: true }).waitFor();
    },
  },
  {
    id: '11-full-program-exit-confirm',
    label: 'Full Program — Exit Confirmation',
    enter: async (page) => {
      await beginSession(page, 'Full Program');
      await page.locator('.p6-video-playing-modal__ctrl-exit').click();
      await page.getByText('Exit Session?', { exact: true }).waitFor();
    },
  },
]);

async function collectGeometry(page, state) {
  return page.evaluate(({ stateId, stateLabel, viewport }) => {
    const round = (number) => Math.round(number * 100) / 100;
    const isVisible = (element, style, rect) =>
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 &&
      rect.width > 0 &&
      rect.height > 0;

    const nodePath = (element) => {
      const segments = [];
      let node = element;
      while (node && node !== document.documentElement) {
        let segment = node.tagName.toLowerCase();
        if (node.id) {
          segment += `#${node.id}`;
          segments.unshift(segment);
          break;
        }
        const classes = [...node.classList].filter((name) => name.startsWith('p6-'));
        if (classes.length) segment += `.${classes.join('.')}`;
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
          if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        segments.unshift(segment);
        node = parent;
      }
      return segments.join(' > ');
    };

    const textLineRects = (element) => {
      const leafTextNodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      while (walker.nextNode()) leafTextNodes.push(walker.currentNode);
      const rects = [];
      for (const node of leafTextNodes) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) {
            rects.push({
              x: round(rect.x),
              y: round(rect.y),
              width: round(rect.width),
              height: round(rect.height),
            });
          }
        }
      }
      return rects;
    };

    // Capture every rendered descendant, not only nodes with a p6-* class.
    // Icons and text rails often inherit their geometry from a p6 parent but
    // carry no p6 class themselves; excluding them previously hid exactly the
    // kind of child/parent mismatch this audit is intended to expose.
    const elements = [
      ...document.querySelectorAll(
        '#p6-bluefin-frame, #p6-bluefin-frame *, ' +
          '#p6-bluefin-overlays, #p6-bluefin-overlays *',
      ),
    ]
      .map((element, index) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (!isVisible(element, style, rect)) return null;
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        const lineRects = text ? textLineRects(element) : [];
        const lineTops = [...new Set(lineRects.map((line) => line.y))];
        return {
          index,
          path: nodePath(element),
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          classes: [...element.classList],
          text: text.slice(0, 500),
          rect: {
            x: round(rect.x),
            y: round(rect.y),
            right: round(rect.right),
            bottom: round(rect.bottom),
            width: round(rect.width),
            height: round(rect.height),
          },
          box: {
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          },
          computed: {
            display: style.display,
            position: style.position,
            boxSizing: style.boxSizing,
            width: style.width,
            height: style.height,
            padding: style.padding,
            margin: style.margin,
            gap: style.gap,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            whiteSpace: style.whiteSpace,
            textAlign: style.textAlign,
            opacity: style.opacity,
            color: style.color,
            backgroundColor: style.backgroundColor,
            border: style.border,
            borderRadius: style.borderRadius,
            transform: style.transform,
            overflow: style.overflow,
            alignItems: style.alignItems,
            justifyContent: style.justifyContent,
            gridTemplateColumns: style.gridTemplateColumns,
            gridTemplateRows: style.gridTemplateRows,
          },
          textMetrics: {
            lineCount: lineTops.length,
            lineRects,
          },
          diagnostics: {
            horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
            verticalOverflow: element.scrollHeight > element.clientHeight + 1,
            outsideViewport:
              rect.left < -1 ||
              rect.top < -1 ||
              rect.right > viewport.width + 1 ||
              rect.bottom > viewport.height + 1,
          },
        };
      })
      .filter(Boolean);

    const keySelectors = [
      '#p6-bluefin-frame',
      '.p6-home__start-here',
      '.p6-start-here-card__title',
      '.p6-start-here-card__chevron',
      '.p6-start-here-card__bullets',
      '.p6-start-here-card__description',
      '.p6-start-here-card__clock',
      '.p6-start-here-card > .p6-duration',
      '.p6-home__divider',
      '.p6-home__divider-track--left .p6-section-divider__line',
      '.p6-home__divider .p6-section-divider__label',
      '.p6-home__divider-track--right .p6-section-divider__line',
      '.p6-home__col-left > .p6-heading',
      '.p6-home__col-left-sub',
      '.p6-home__col-right > .p6-heading',
      '.p6-home__col-right-sub',
      '.p6-home__phase-backdrop',
      '.p6-home__full-backdrop',
      '.p6-home__phase1',
      '.p6-home__phase2',
      '.p6-home__phase1 .p6-phase-card__chevron',
      '.p6-home__phase2 .p6-phase-card__chevron',
      '.p6-home__phase1 .p6-phase-card__description',
      '.p6-home__phase2 .p6-phase-card__description',
      '.p6-home__full-program',
      '.p6-full-program-content__accent',
      '.p6-full-program-content__row1 .p6-keyword-row__sep',
      '.p6-full-program-content__row2 .p6-keyword-row__sep',
      '.p6-full-program-content__steps',
      '.p6-full-program-content__description',
      '.p6-full-program-content__clock',
      '.p6-full-program-content > .p6-duration',
      '.p6-session-modal',
      '.p6-session-modal__title',
      '.p6-session-modal__session-duration',
      '.p6-session-modal__section',
      '.p6-session-modal__list',
      '.p6-session-modal__actions',
      '.p6-video-playing-modal__controls',
      '.p6-video-playing-modal__now',
      '.p6-video-playing-modal__now-row',
      '.p6-video-playing-modal__progress',
      '.p6-video-playing-modal__controls-row',
      '.p6-session-modal__btn--primary svg',
      '.p6-video-playing-modal__volume',
      '.p6-video-playing-modal__volume-btn',
      '.p6-video-playing-modal__volume-slider-wrap',
      '.p6-video-playing-modal__volume-slider',
      '.p6-confirm-panel__title',
      '.p6-confirm-panel__actions',
    ];
    const keyGeometry = {};
    for (const selector of keySelectors) {
      keyGeometry[selector] = [...document.querySelectorAll(selector)].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: round(rect.x),
          y: round(rect.y),
          right: round(rect.right),
          bottom: round(rect.bottom),
          width: round(rect.width),
          height: round(rect.height),
        };
      });
    }

    return {
      stateId,
      stateLabel,
      capturedAt: new Date().toISOString(),
      viewport: {
        requested: viewport,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        devicePixelRatio: window.devicePixelRatio,
        visualViewport: window.visualViewport
          ? {
              width: round(window.visualViewport.width),
              height: round(window.visualViewport.height),
              scale: window.visualViewport.scale,
            }
          : null,
      },
      location: window.location.href,
      keyGeometry,
      elements,
    };
  }, { stateId: state.id, stateLabel: state.label, viewport: VIEWPORT });
}

function writeIndex(outputRoot, runReport) {
  const cards = runReport.states
    .map(
      (state) => `
      <article>
        <h2>${state.label}</h2>
        <img src="${state.screenshot}?v=${state.screenshotSha256}" alt="${state.label}">
        <p><a href="${state.geometry}?v=${state.screenshotSha256}">computed geometry</a></p>
      </article>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perform6 packaged Bluefin audit</title>
<style>
  :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
  body { margin: 0; padding: 24px; background: #090b10; color: #f6f7fb; }
  header { margin-bottom: 28px; }
  code { color: #7dd3fc; }
  main { display: grid; grid-template-columns: repeat(auto-fit,minmax(520px,1fr)); gap: 24px; }
  article { padding: 16px; border: 1px solid #263244; border-radius: 12px; background: #111622; }
  h2 { font-size: 17px; }
  img { display: block; width: 100%; height: auto; border: 1px solid #263244; }
  a { color: #38bdf8; }
</style>
<body>
  <header>
    <h1>Perform6 packaged Bluefin audit</h1>
    <p>Artifact SHA-256: <code>${runReport.artifact.sha256}</code></p>
    <p>Canvas: ${VIEWPORT.width}x${VIEWPORT.height}, DPR 1 · ${runReport.states.length} real UI states</p>
  </header>
  <main>${cards}</main>
</body>
</html>`;
  fs.writeFileSync(path.join(outputRoot, 'index.html'), html);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.zip)) throw new Error(`Release ZIP not found: ${args.zip}`);

  const zipHash = sha256File(args.zip);
  const runName = `${path.basename(args.zip, '.zip')}-${zipHash.slice(0, 12)}`;
  const outputRoot = path.resolve(
    args.out || path.join(os.tmpdir(), 'perform6-bluefin-ui-audit', runName),
  );
  const forbiddenOutputRoots = new Set([
    path.parse(outputRoot).root,
    os.homedir(),
    repoRoot,
  ]);
  if (forbiddenOutputRoots.has(outputRoot)) {
    throw new Error(`Refusing to replace unsafe audit output path: ${outputRoot}`);
  }
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'perform6-package-'));
  execFileSync('unzip', ['-qq', args.zip, '-d', extractRoot]);
  const packageRoot = findPackageRoot(extractRoot);
  const releaseFile = path.join(packageRoot, 'perform6-release.json');
  const release = fs.existsSync(releaseFile)
    ? JSON.parse(fs.readFileSync(releaseFile, 'utf8'))
    : null;
  const criticalFiles = ['index.html', 'assets/app.js', 'assets/style.css', 'autorun.brs'];
  const fileHashes = Object.fromEntries(
    criticalFiles.map((relative) => {
      const file = path.join(packageRoot, relative);
      return [relative, fs.existsSync(file) ? sha256File(file) : null];
    }),
  );

  const { server, url } = await startStaticServer(packageRoot);
  const { chromium } = loadPlaywright();
  const launchOptions = {
    headless: !args.headed,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
    ],
  };
  if (args.browser) {
    launchOptions.executablePath = path.resolve(args.browser);
  } else {
    // Playwright may have the full pinned Chromium but not the optional
    // chrome-headless-shell executable. Explicitly select the pinned browser.
    const pinnedChromium = chromium.executablePath();
    if (pinnedChromium && fs.existsSync(pinnedChromium)) {
      launchOptions.executablePath = pinnedChromium;
    } else {
      const systemBrowsers = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
      ];
      const systemBrowser = systemBrowsers.find((candidate) => fs.existsSync(candidate));
      if (systemBrowser) launchOptions.executablePath = systemBrowser;
    }
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const runReport = {
    generatedAt: new Date().toISOString(),
    artifact: {
      zip: args.zip,
      sha256: zipHash,
      release,
      criticalFileSha256: fileHashes,
      packageBytesUntouched: true,
    },
    execution: {
      servedFrom: url,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      browserExecutable:
        launchOptions.executablePath ?? chromium.executablePath() ?? null,
      browserVersion: await browser.version(),
      nodeVersion: process.version,
      apiMode: 'locally fulfilled; no production requests forwarded',
      stateMode: 'persisted device/content fixtures + real packaged controls',
    },
    states: [],
  };

  try {
    for (const state of STATES) {
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await installApiIsolation(page);
      await page.addInitScript((fixture) => {
        for (const [key, value] of Object.entries(fixture)) {
          window.localStorage.setItem(key, value);
        }
      }, persistedStateFixture());

      await page.goto(
        `${url}?bs_serial=VISUAL-AUDIT-XT2145&bs_model=XT2145&bs_fw=9.0.162&bs_mac=001122334455#/touch`,
        { waitUntil: 'domcontentloaded', timeout: 20_000 },
      );
      await waitForUi(page);
      await state.enter(page);
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });
      await page.waitForTimeout(250);

      const screenshotName = `${state.id}.png`;
      const geometryName = `${state.id}.geometry.json`;
      const screenshotPath = path.join(outputRoot, screenshotName);
      const geometryPath = path.join(outputRoot, geometryName);
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
        animations: 'disabled',
      });
      const geometry = await collectGeometry(page, state);
      fs.writeFileSync(geometryPath, `${JSON.stringify(geometry, null, 2)}\n`);

      runReport.states.push({
        id: state.id,
        label: state.label,
        screenshot: screenshotName,
        screenshotSha256: sha256File(screenshotPath),
        geometry: geometryName,
        viewport: geometry.viewport,
        keyGeometry: geometry.keyGeometry,
        consoleErrors,
        pageErrors,
      });
      await page.close();
      console.log(`[bluefin-package-audit] captured ${state.id}`);
    }
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (!args.keepExtracted) fs.rmSync(extractRoot, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(outputRoot, 'run-report.json'),
    `${JSON.stringify(runReport, null, 2)}\n`,
  );
  writeIndex(outputRoot, runReport);

  console.log(`\n[bluefin-package-audit] artifact SHA-256 ${zipHash}`);
  console.log(`[bluefin-package-audit] output ${outputRoot}`);
  console.log(`[bluefin-package-audit] states ${runReport.states.length}/${STATES.length}`);
}

main().catch((error) => {
  console.error(
    `\n[bluefin-package-audit] FAILED: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
