#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(root, process.argv[2] ?? 'dist');
const apiPattern = '**/api/v1**';

function mimeType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  })[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function findCodexPlaywright() {
  const queue = [
    path.join(os.homedir(), '.cache', 'codex-runtimes'),
    path.join(os.homedir(), '.codex'),
  ].filter((candidate) => fs.existsSync(candidate));
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
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
    }
  }
  return null;
}

function loadPlaywright() {
  for (const candidate of ['playwright', process.env.PLAYWRIGHT_MODULE_PATH, findCodexPlaywright()].filter(Boolean)) {
    try {
      return require(candidate);
    } catch {
      // Try the next available runtime.
    }
  }
  throw new Error('Playwright not found');
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const requested = path.resolve(packageRoot, relative);
    const safe = requested.startsWith(`${packageRoot}${path.sep}`);
    const file = safe && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(packageRoot, 'index.html');
    response.writeHead(200, {
      'Content-Type': mimeType(file),
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('server address unavailable'));
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

const media = {
  id: 'offline-default',
  title: 'Offline Default',
  fileUrl: 'https://offline-flow.invalid/default.mp4',
};

function runtimeManifest() {
  return {
    version: 'offline-cached-sync',
    updatedAt: '2026-10-20T00:00:00.000Z',
    deployment: {
      id: 'offline-device',
      name: 'TOUCH_SCREEN',
      libraryId: 'Golf',
      libraryName: 'Golf',
      currentDay: 1,
      totalDays: 36,
    },
    screens: [{
      id: 'touch-default',
      label: media.title,
      currentVideo: { id: media.id, type: 'video', url: media.fileUrl, title: media.title },
      playlist: [{ id: media.id, type: 'video', url: media.fileUrl, title: media.title }],
      rotationDay: 1,
    }],
  };
}

function persistedState(includeCache = true) {
  const state = {
    'perform6-device': JSON.stringify({
      state: {
        pairingId: 'offline-pairing',
        deviceId: 'offline-device',
        apiToken: 'offline-token',
        pairingCode: null,
        registrationStatus: 'registered',
        hasCredentials: true,
      },
      version: 2,
    }),
  };
  if (!includeCache) return state;
  return {
    ...state,
    'perform6-playback-manifest': JSON.stringify({
      savedAt: '2026-10-20T00:00:00.000Z',
      manifest: runtimeManifest(),
      profile: 'XT2145',
    }),
    'perform6-sd-cache-ready': JSON.stringify({ [media.id]: media.fileUrl }),
    'perform6-sd-cache-confirmed': JSON.stringify([media.id]),
    'perform6-cached-media-ids': JSON.stringify([media.id]),
    'perform6-media-pool-paths-ver': '3-storage-sd',
  };
}

const syncData = {
  syncJobId: 'online-recovery-sync',
  device: { id: 'offline-device', currentRotationDay: 1 },
  deployment: { deploymentType: 'TOUCH_SCREEN', fieldCategory: 'Golf', exerciseVariant: 'No Wall' },
  playbackManifest: {
    deviceId: 'offline-device',
    deploymentType: 'TOUCH_SCREEN',
    field: 'Golf',
    variant: 'No Wall',
    rotationDay: 1,
    content: {
      default: { label: 'Default', isRotating: false, items: [{ video: media.title, mediaVersionId: media.id, fileUrl: media.fileUrl }] },
    },
  },
  media: [],
  requiredMedia: [],
  retainMediaVersionIds: [media.id],
  evictMediaVersionIds: [],
  runtime: { version: '2.1.5', updateAvailable: false },
};

async function seed(page, includeCache) {
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, persistedState(includeCache));
}

async function main() {
  assert.ok(fs.existsSync(path.join(packageRoot, 'index.html')), `package missing: ${packageRoot}`);
  const { chromium } = loadPlaywright();
  const { server, url } = await startServer();
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
  });

  try {
    let mode = 'offline';
    let syncRequests = 0;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await seed(page, true);
    await page.route(apiPattern, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/sync/check')) syncRequests += 1;
      if (mode === 'offline') return route.abort('failed');
      if (mode === 'server-error') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'server rejected sync' }) });
      }
      const data = pathname.endsWith('/sync/check')
        ? syncData
        : pathname.endsWith('/devices/me/heartbeat')
          ? { success: true, remoteCommands: [] }
          : {};
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, data }),
      });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.p6-home__start-here').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(750);
    assert.match(page.url(), /\/touch$/);
    assert.equal(await page.getByText('A problem occurred', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Internet is not connected to this device', { exact: true }).count(), 0);
    assert.ok(syncRequests >= 1, 'offline boot never attempted /sync/check');

    const beforeReconnect = syncRequests;
    mode = 'online';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(
      () => document.querySelector('.p6-home__start-here') != null,
      undefined,
      { timeout: 10_000 },
    );
    const deadline = Date.now() + 10_000;
    while (syncRequests <= beforeReconnect && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
    assert.ok(syncRequests > beforeReconnect, 'network restoration did not trigger /sync/check');
    assert.equal(await page.getByText('A problem occurred', { exact: true }).count(), 0);
    assert.equal(await page.locator('.p6-home__start-here').count(), 1);
    await context.close();

    mode = 'server-error';
    const errorContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const errorPage = await errorContext.newPage();
    await seed(errorPage, true);
    await errorPage.route(apiPattern, async (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'server rejected sync' }),
    }));
    await errorPage.goto(url, { waitUntil: 'domcontentloaded' });
    await errorPage.getByText('A problem occurred', { exact: true }).waitFor({ timeout: 20_000 });
    await errorContext.close();

    mode = 'offline';
    const emptyContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const emptyPage = await emptyContext.newPage();
    await seed(emptyPage, false);
    await emptyPage.route(apiPattern, async (route) => route.abort('failed'));
    await emptyPage.goto(url, { waitUntil: 'domcontentloaded' });
    await emptyPage.getByText('A problem occurred', { exact: true }).waitFor({ timeout: 20_000 });
    await emptyContext.close();

    console.log('[offline-runtime] PASS cached cold boot, reconnect sync, server-error guard, empty-cache guard');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await main();
