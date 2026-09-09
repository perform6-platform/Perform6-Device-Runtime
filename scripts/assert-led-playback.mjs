/**
 * Offline asserts: per-profile docs-style autoruns + JS SD-primary LED path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`[assert:led-playback] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[assert:led-playback] OK: ${msg}`);
}

function isNativeLedPlayableSrc(src) {
  if (!src || src.startsWith('blob:')) return false;
  const lower = src.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  let sd = src.trim();
  if (sd.startsWith('file:///SD:/') || sd.startsWith('file:///sd:/')) {
    sd = `SD:/${sd.slice('file:///SD:/'.length)}`;
  } else if (sd.startsWith('/storage/sd/')) {
    sd = `SD:/${sd.slice('/storage/sd/'.length)}`;
  } else if (/^sd:/i.test(sd)) {
    sd = `SD:/${sd.replace(/^sd:\/*/i, '')}`;
  }
  const pathLower = sd.toLowerCase().split('?')[0] ?? '';
  if (!pathLower.startsWith('sd:/')) return false;
  if (pathLower.includes('perform6-media-pool')) {
    return pathLower.length > 'sd:/perform6-media-pool/'.length;
  }
  return (
    pathLower.endsWith('.mp4') ||
    pathLower.endsWith('.mov') ||
    pathLower.endsWith('.m4v') ||
    pathLower.endsWith('.webm')
  );
}

function assertPathRules() {
  const pool =
    'SD:/perform6-media-pool/ab/sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  if (!isNativeLedPlayableSrc(pool)) fail('extensionless pool SD:/ path must be playable');
  if (isNativeLedPlayableSrc('https://cdn.example/v.mp4')) fail('HTTPS must not be native LED playable');
  ok('path playability rules');
}

/** Docs-critical: zones + SD PlayFile + hang-proof + soft-alive. */
const LED_NEEDLES = [
  'LED PRIMARY',
  'perform6-led-playback.json',
  'MaybePollLedPlaybackFile',
  'ApplyNativePlayback',
  'PlayLocalFile pool-direct OK',
  'ProbeString',
  'NO on-demand HTTPS stream',
  'FATAL soft-alive',
  'WriteBootCanary',
  'WriteMainHeartbeat',
  'roNodeJsEvent',
  'led-cache-prefetch ignored',
  'led-ota-install ignored',
  'led-storage-info-result',
  'led-log-tail',
  'load-error after HTML/bridge — soft-alive (no SetUrl, no auto-reboot)',
  'AtomicWriteAsciiFile',
  'Sub Main(',
  'MaybeRunDeferredBootWork',
  'WriteBootStepCanary',
  'alive-f6ed41',
  'no auto-reboot',
  'DrainOnePostJs',
  'EnqueuePostJs',
  'Single BA-style attempt',
  'BootSleepSlices',
  'No CreateDirectory here',
  'cfg2.nodejs_enabled = true',
  'cfg3.nodejs_enabled = true',
  'SD LED PRIMARY poll 2s',
  'pbFileTimer (2s) is the sole SD LED resume path',
];

const BANNED = [
  'Sub HandleCacheEvent',
  'Sub HandleOtaEvent',
  'Sub StartCacheDownload',
  'Sub DrainMp4AliasQueueOne',
  'Function EnsureMp4PlayAlias',
  'Function PoolMp4AliasPath',
  'PlayLocalFile alias-hit',
  'Sub RecycleHtmlWidget',
  'DiagEchoInbound',
  'ScheduleDeferredLedReady',
  'Function DeleteTreeBudgeted',
  'Sub MaybeProcessDeferredWipe',
  'FATAL - auto reboot once',
  '/storage/sd/perform6-led-playback.json',
  'Sleep(500)',
  'htmlTouch.SetUrl(',
  'htmlPrimary.SetUrl(',
  'HtmlWidget classic constructor',
];

function assertOneAutorun(relPath, { led = true } = {}) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) fail(`missing ${relPath}`);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.split(/\r?\n/).length;
  if (lines > 2800) fail(`${relPath} still too thick (${lines} lines) — expected docs-thin <2800`);

  const needles = led
    ? LED_NEEDLES
    : [
        'Sub Main(',
        'WriteBootCanary',
        'WriteMainHeartbeat',
        'WriteBootStepCanary',
        'alive-f6ed41',
        'FATAL soft-alive',
        'roNodeJsEvent',
        'load-error after HTML/bridge — soft-alive (no SetUrl, no auto-reboot)',
        'no auto-reboot',
        'DrainOnePostJs',
        'EnqueuePostJs',
        'BootSleepSlices',
        'cfg2.nodejs_enabled = true',
        'cfg3.nodejs_enabled = true',
      ];

  for (const needle of needles) {
    if (!text.includes(needle)) fail(`${relPath} missing ${needle}`);
  }
  for (const banned of BANNED) {
    if (text.includes(banned)) fail(`${relPath} must not contain ${banned}`);
  }
  if (led) {
    if (!text.includes('profile = "XT2145" or profile = "XC4055"')) {
      fail(`${relPath} must poll LED bus for XT+XC`);
    }
    if (text.includes('PostLedReady(htmlTouch, "xt-led-ready"') || text.includes("PostLedReady(htmlTouch, \"xt-led-ready\"")) {
      fail(`${relPath}: XT must not PostLedReady before loop-enter`);
    }
    const flushIdx = text.indexOf('Sub FlushLedLog(');
    const flushEnd = text.indexOf('End Sub', flushIdx);
    const flushBody = flushIdx >= 0 && flushEnd > flushIdx ? text.slice(flushIdx, flushEnd) : '';
    if (/ReadAsciiFile\s*\(\s*(path|"SD:\/perform6-led\.log")/.test(flushBody)) {
      fail(`${relPath}: FlushLedLog must not ReadAsciiFile(perform6-led.log)`);
    }
  }
  if (text.includes('LogDisplayIdentity(')) {
    fail(`${relPath}: dangling LogDisplayIdentity call`);
  }
  ok(`${relPath} (${lines} lines)`);
}

function assertAutorun() {
  assertOneAutorun('brightsign/autorun-xt2145.brs', { led: true });
  assertOneAutorun('brightsign/autorun-xc4055.brs', { led: true });
  assertOneAutorun('brightsign/autorun-hd226.brs', { led: false });
  if (fs.existsSync(path.join(root, 'brightsign', 'autorun.brs'))) {
    fail('brightsign/autorun.brs godfile must be removed — use per-profile autorun-*.brs');
  }
  ok('per-profile docs-style autoruns');
}

function assertJs() {
  const led = fs.readFileSync(path.join(root, 'src', 'platform', 'ledPlaybackFile.ts'), 'utf8');
  if (!led.includes('writeLedPlaybackFile')) fail('ledPlaybackFile missing writer');
  if (!led.includes('toLedPlayableSrc')) fail('ledPlaybackFile must normalize via toLedPlayableSrc');
  if (!led.includes('PRIMARY path')) fail('ledPlaybackFile must document SD as PRIMARY path');

  const aliasQ = fs.readFileSync(path.join(root, 'src', 'services', 'mp4AliasQueue.ts'), 'utf8');
  if (!aliasQ.includes('intentionally empty') && !aliasQ.includes('Do NOT enqueue autorun CopyFile')) {
    fail('mp4AliasQueue must be pool-direct no-op (no autorun CopyFile enqueue)');
  }
  if (/\bcopyFileSync\b/.test(aliasQ) || aliasQ.includes('mp4 alias copy OK')) {
    fail('mp4AliasQueue must not contain copyFileSync / alias copy');
  }

  const xt = fs.readFileSync(path.join(root, 'src', 'platform', 'xtOutputBridge.ts'), 'utf8');
  if (!xt.includes('writeXtPlaybackFile')) fail('XT bridge must write SD bus');
  if (!xt.includes('PostBSMessage')) fail('XT bridge must PostBSMessage');
  if (!xt.includes('SD-primary')) fail('XT LED must be SD-primary');
  if (xt.includes('ack-timeout')) fail('XT must not wait on ack-timeout for LED');
  if (!xt.includes('no auto-reboot')) fail('XT must not auto-reboot on LED miss');

  const xc = fs.readFileSync(path.join(root, 'src', 'platform', 'xcOutputBridge.ts'), 'utf8');
  if (!xc.includes('PostBSMessage')) fail('XC bridge must PostBSMessage');
  if (!xc.includes('SD-primary')) fail('XC LED must be SD-primary');
  if (xc.includes('ack-timeout')) fail('XC must not wait on ack-timeout for LED');
  if (!xc.includes('no auto-reboot')) fail('XC must not auto-reboot on LED miss');

  const port = fs.readFileSync(path.join(root, 'src', 'platform', 'bsMessagePort.ts'), 'utf8');
  if (!port.includes('isBridgeDuplexTransport')) {
    fail('bsMessagePort must expose isBridgeDuplexTransport');
  }
  if (!port.includes('@brightsign/messageport')) {
    fail('bsMessagePort must prefer Node @brightsign/messageport');
  }

  const mediaPool = fs.readFileSync(path.join(root, 'src', 'services', 'mediaAssetPool.ts'), 'utf8');
  if (!mediaPool.includes('ensureMediaPoolDir') || !mediaPool.includes('mkdirSync')) {
    fail('mediaAssetPool must mkdir pool dir in JS before AssetPool ctor');
  }

  const keepalive = fs.readFileSync(path.join(root, 'src', 'services', 'bridgeKeepalive.ts'), 'utf8');
  if (!keepalive.includes('observe-only') && !keepalive.includes('Never auto-reboot')) {
    fail('bridgeKeepalive must be observe-only / no auto-reboot from probe');
  }
  if (!keepalive.includes('BRIDGE_GRACE_MS') || !keepalive.includes('HELLO_RETRY_GRACE_MS')) {
    fail('bridgeKeepalive must define boot grace + fast hello retry');
  }

  const store = fs.readFileSync(path.join(root, 'src', 'stores', 'runtimeStore.ts'), 'utf8');
  if (!store.includes('sanitizeDisplaySrc') || !store.includes('sanitizeFallbackSrc')) {
    fail('runtimeStore must sanitize display/fallback (no on-demand HTTPS)');
  }

  const playbackSrc = fs.readFileSync(path.join(root, 'src', 'services', 'playbackSrc.ts'), 'utf8');
  if (!playbackSrc.includes('no on-demand')) {
    fail('playbackSrc must document no on-demand HTTPS');
  }

  ok('JS SD-primary LED + docs-style optional messageport');
}

assertPathRules();
assertAutorun();
assertJs();
console.log('[assert:led-playback] all checks passed');
