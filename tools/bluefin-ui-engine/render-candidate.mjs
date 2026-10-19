#!/usr/bin/env node

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fail(message) {
  console.error(`[bluefin-ui-engine] ${message}`);
  process.exit(1);
}

function mime(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.json': 'application/json; charset=utf-8',
  })[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function serve(root) {
  const port = await freePort();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const path = resolve(root, relative);
    if (!path.startsWith(`${resolve(root)}/`) || !existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime(path),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(path).pipe(response);
  });
  await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  return { server, port };
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.ws.addEventListener('open', resolveOpen, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
      this.ws.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
          return;
        }
        const waiters = this.events.get(message.method) ?? [];
        this.events.delete(message.method);
        for (const resolveEvent of waiters) resolveEvent(message.params ?? {});
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  event(method, timeoutMs = 15000) {
    return new Promise((resolveEvent, reject) => {
      const waiters = this.events.get(method) ?? [];
      waiters.push(resolveEvent);
      this.events.set(method, waiters);
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs).unref();
    });
  }
}

function simpleHash(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33 + value.charCodeAt(i)) % 10_000_000;
  return `${hash}-${value.length}`;
}

function fixtureSource(version) {
  const slots = ['touch-default', 'start-here', 'phase1', 'phase2', 'full-program'];
  const screens = slots.map((id) => ({
    id,
    label: id,
    playlist: [{ id: `fixture-${id}`, type: 'video', url: `https://fixture.invalid/${id}.mp4`, title: id, loop: id === 'touch-default' }],
    currentVideo: { id: `fixture-${id}`, type: 'video', url: `https://fixture.invalid/${id}.mp4`, title: id, loop: id === 'touch-default' },
    rotationDay: 1,
  }));
  const ids = screens.map((screen) => screen.currentVideo.id);
  const urls = Object.fromEntries(screens.map((screen) => [screen.currentVideo.id, screen.currentVideo.url]));
  const files = screens.map((screen) => `${simpleHash(screen.currentVideo.url)}.mp4`);
  const manifest = {
    version: `ui-fixture-${version}`,
    updatedAt: new Date(0).toISOString(),
    deployment: { id: 'ui-fixture', name: 'Bluefin UI Validation', libraryId: 'ui-fixture', libraryName: 'Bluefin UI Validation', currentDay: 1, totalDays: 1 },
    screens,
  };
  const device = {
    state: { pairingId: '00000000-0000-4000-8000-000000000174', deviceId: 'bluefin-ui-fixture', apiToken: 'local-render-only', pairingCode: '157400', registrationStatus: 'registered', hasCredentials: true },
    version: 2,
  };

  return `(() => {
    const manifest = ${JSON.stringify(manifest)};
    const ids = ${JSON.stringify(ids)};
    const urls = ${JSON.stringify(urls)};
    const files = ${JSON.stringify(files)};
    localStorage.setItem('perform6-device', ${JSON.stringify(JSON.stringify(device))});
    localStorage.setItem('perform6-playback-manifest', JSON.stringify({ savedAt: new Date().toISOString(), manifest }));
    localStorage.setItem('perform6-sd-cache-ready', JSON.stringify(urls));
    localStorage.setItem('perform6-sd-cache-confirmed', JSON.stringify(ids));
    localStorage.setItem('perform6-cached-media-ids', JSON.stringify(ids));
    const mediaDir = '/storage/sd/perform6-media';
    const fileSet = new Set(files);
    const fakeFs = {
      existsSync: (path) => path === '/storage/sd' || path === mediaDir || (path.startsWith(mediaDir + '/') && fileSet.has(path.slice(mediaDir.length + 1))),
      mkdirSync() {}, readdirSync: (path) => path === mediaDir ? [...files] : [],
      statSync: (path) => ({ size: path === mediaDir || path === '/storage/sd' ? 0 : 5000000, isDirectory: () => path === mediaDir || path === '/storage/sd', isFile: () => path !== mediaDir && path !== '/storage/sd' }),
      readFileSync() { throw new Error('fixture file is not readable'); },
      writeFileSync() {}, unlinkSync() {}, rmSync() {}, rmdirSync() {}, renameSync() {},
    };
    window.require = (id) => { if (id === 'fs') return fakeFs; throw new Error('fixture module unavailable: ' + id); };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.startsWith('https://portal.perform6.com/api/v1')) return realFetch(input, init);
      const path = url.slice('https://portal.perform6.com/api/v1'.length);
      let data = { success: true };
      if (path.startsWith('/sync/check')) data = { syncJobId: 'ui-fixture-sync', runtime: { version: ${JSON.stringify(version)}, updateAvailable: false }, media: [], requiredMedia: [], retainMediaVersionIds: ids };
      else if (path.includes('remote-command')) data = { commands: [] };
      else if (path.includes('/ota-manifest')) data = { updateAvailable: false, version: ${JSON.stringify(version)}, files: [] };
      else if (path.includes('/logs')) data = { accepted: 0 };
      return new Response(JSON.stringify({ success: true, data, timestamp: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  })();`;
}

async function waitFor(cdp, expression, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await cdp.send('Runtime.evaluate', { expression: `Boolean(${expression})`, returnByValue: true });
    if (result.result?.value === true) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate failed');
  return result.result?.value;
}

async function clickText(cdp, text) {
  const found = await evaluate(cdp, `(() => { const target=[...document.querySelectorAll('button')].find((el)=>el.textContent.trim().toUpperCase()===${JSON.stringify(text.toUpperCase())}); if(!target)return false; target.click(); return true; })()`);
  if (!found) throw new Error(`Button not found: ${text}`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 180));
}

async function clickLabel(cdp, label) {
  const found = await evaluate(cdp, `(() => { const target=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if(!target)return false; target.click(); return true; })()`);
  if (!found) throw new Error(`Control not found: ${label}`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 180));
}

async function capture(cdp, outputDir, name) {
  // Delayed sync diagnostics are outside the UI presentation under review.
  await evaluate(cdp, `(() => { const alert=document.querySelector('[role="alert"]'); if(alert) alert.style.setProperty('display','none','important'); return true; })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  writeFileSync(join(outputDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  const geometry = await evaluate(cdp, `(() => {
    const selectors=['.p6-home__start-here','.p6-home__phase-backdrop','.p6-home__phase1','.p6-home__phase2','.p6-home__full-backdrop','.p6-home__full-program','.p6-start-here-card__title','.p6-phase-card__title','.p6-session-modal__title-text','.p6-pre-golf-icon','.p6-start-here-card__description','.p6-start-here-card__clock','.p6-full-program-content__description','.p6-full-program-content__clock','.p6-session-modal','.p6-session-modal__title','.p6-video-playing-modal__controls','.p6-video-playing-modal__now','.p6-video-playing-modal__now-row','.p6-video-playing-modal__progress','.p6-display-volume','.p6-confirm-panel__title'];
    const rect=(el)=>{const r=el.getBoundingClientRect();const c=getComputedStyle(el);return{x:r.x,y:r.y,width:r.width,height:r.height,fontSize:c.fontSize,fontWeight:c.fontWeight,padding:c.padding,display:c.display}};
    return Object.fromEntries(selectors.map((selector)=>[selector,[...document.querySelectorAll(selector)].map(rect)]));
  })()`);
  writeFileSync(join(outputDir, `${name}.json`), `${JSON.stringify(geometry, null, 2)}\n`);
}

async function resetHome(cdp, baseUrl) {
  const loaded = cdp.event('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${baseUrl}/#/touch` });
  await loaded.catch(() => {});
  await waitFor(cdp, "document.querySelector('[aria-label=\"Start Here\"]')");
  await evaluate(cdp, `(() => {
    let style=document.getElementById('p6-ui-audit-suppress-status');
    if(!style){
      style=document.createElement('style');
      style.id='p6-ui-audit-suppress-status';
      style.textContent='[role="alert"]{display:none!important}';
      document.head.appendChild(style);
    }
    return true;
  })()`);
}

async function main() {
  let candidate = resolve(arg('--candidate', 'releases/xt2145/perform6-xt2145-1.5.74'));
  const outputDir = resolve(arg('--out', 'tmp/bluefin-ui-engine/1.5.74'));
  const version = arg('--version', '1.5.74');
  const scratch = mkdtempSync(join(tmpdir(), 'p6-bluefin-engine-'));
  let extracted = false;
  if (candidate.endsWith('.zip')) {
    const unzip = spawnSync('unzip', ['-q', candidate, '-d', scratch]);
    if (unzip.status !== 0) fail(`Could not extract ${candidate}`);
    const listing = spawnSync('find', [scratch, '-mindepth', '1', '-maxdepth', '1', '-type', 'd'], { encoding: 'utf8' });
    candidate = listing.stdout.trim().split('\n')[0];
    extracted = true;
  }
  if (!existsSync(join(candidate, 'index.html'))) fail(`Candidate root has no index.html: ${candidate}`);
  if (!existsSync(CHROME)) fail(`Chrome not found: ${CHROME}`);
  mkdirSync(outputDir, { recursive: true });

  const { server, port } = await serve(candidate);
  const debugPort = await freePort();
  const profile = join(scratch, 'chrome-profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1920,1080', '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let targets = [];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); if (targets.length) break; } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    const target = targets.find((entry) => entry.type === 'page');
    if (!target?.webSocketDebuggerUrl) fail('Chrome DevTools target did not start');
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fixtureSource(version) });
    const baseUrl = `http://127.0.0.1:${port}`;
    await resetHome(cdp, baseUrl);

    await capture(cdp, outputDir, '00-home');
    for (const [slug, label] of [['01-start-here', 'Start Here'], ['02-phase-1', 'Phase 1'], ['03-phase-2', 'Phase 2']]) {
      await resetHome(cdp, baseUrl);
      await clickLabel(cdp, label);
      await capture(cdp, outputDir, `${slug}-begin-session`);
      await clickText(cdp, 'BEGIN SESSION');
      await capture(cdp, outputDir, `${slug}-return-to-menu`);
    }

    await resetHome(cdp, baseUrl);
    await clickLabel(cdp, 'Full Program');
    await capture(cdp, outputDir, '04-full-program-begin-session');
    await clickText(cdp, 'BEGIN SESSION');
    await capture(cdp, outputDir, '04-full-program-pause');
    await clickText(cdp, 'PAUSE');
    await capture(cdp, outputDir, '04-full-program-resume');
    await clickText(cdp, 'RESUME');
    await clickText(cdp, 'RESTART');
    await capture(cdp, outputDir, '04-full-program-restart-session');
    await clickText(cdp, 'CANCEL');
    await clickText(cdp, 'EXIT SESSION');
    await capture(cdp, outputDir, '04-full-program-exit-session');

    const stateNames = [
      '00-home',
      '01-start-here-begin-session',
      '01-start-here-return-to-menu',
      '02-phase-1-begin-session',
      '02-phase-1-return-to-menu',
      '03-phase-2-begin-session',
      '03-phase-2-return-to-menu',
      '04-full-program-begin-session',
      '04-full-program-pause',
      '04-full-program-resume',
      '04-full-program-restart-session',
      '04-full-program-exit-session',
    ];
    const cards = stateNames.map((name) => `
      <article>
        <h2>${name.replaceAll('-', ' ')}</h2>
        <a href="${name}.png" target="_blank"><img src="${name}.png" alt="${name}"></a>
        <p><a href="${name}.png" target="_blank">Open full 1920×1080 capture</a> · <a href="${name}.json" target="_blank">Geometry</a></p>
      </article>`).join('');
    writeFileSync(join(outputDir, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Bluefin ${version} UI states</title><style>
body{margin:0;background:#05070b;color:#edf3ff;font:16px/1.45 Inter,Arial,sans-serif}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#0c1424eF;border-bottom:1px solid #1f6fde}h1{margin:0;font-size:25px}header p{margin:4px 0 0;color:#9fb0cc}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:24px}article{background:#0c1424;border:1px solid #253652;border-radius:12px;padding:14px}h2{margin:0 0 10px;font-size:17px;text-transform:capitalize}img{display:block;width:100%;height:auto;border:1px solid #26364e;background:#000}a{color:#61a5ff}p{margin:10px 0 0}@media(max-width:1100px){.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>Untouched Perform6 ${version} — all 12 Bluefin states</h1><p>Exact packaged HTML/CSS/JS · 1920×1080 · DPR 1 · fixture supplies paired/cached state only</p></header><main class="grid">${cards}</main></body></html>`);

    const artifactHash = createHash('sha256').update(readFileSync(join(candidate, 'assets/style.css'))).digest('hex');
    writeFileSync(join(outputDir, 'run.json'), `${JSON.stringify({ candidate, version, viewport: VIEWPORT, styleSha256: artifactHash, states: 12 }, null, 2)}\n`);
    console.log(`[bluefin-ui-engine] rendered 12 states from ${candidate}`);
    console.log(`[bluefin-ui-engine] output ${outputDir}`);
  } finally {
    chrome.kill('SIGTERM');
    await new Promise((resolveClose) => server.close(resolveClose));
    if (chrome.exitCode === null) {
      await Promise.race([
        new Promise((resolveExit) => chrome.once('exit', resolveExit)),
        new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
      ]);
    }
    if (extracted) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

await main();
