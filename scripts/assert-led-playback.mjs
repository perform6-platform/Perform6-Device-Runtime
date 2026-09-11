/**
 * Offline asserts: thin autorun + BA-style bridge primary LED path.
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
  return (
    pathLower.endsWith('.mp4') ||
    pathLower.endsWith('.mov') ||
    pathLower.endsWith('.m4v') ||
    pathLower.endsWith('.webm')
  );
}

function assertPathRules() {
  const realized = 'SD:/perform6-media/1234567-99.mp4';
  if (!isNativeLedPlayableSrc(realized)) fail('realized SD:/ .mp4 path must be playable');
  const pool =
    'SD:/perform6-media-pool/ab/sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  if (isNativeLedPlayableSrc(pool)) fail('extensionless pool path must not be the asserted native route');
  if (isNativeLedPlayableSrc('https://cdn.example/v.mp4')) fail('HTTPS must not be native LED playable');
  ok('path playability rules');
}

function assertAutorun() {
  const text = fs.readFileSync(path.join(root, 'brightsign', 'autorun.brs'), 'utf8');
  const lines = text.split(/\r?\n/).length;
  if (lines > 3600) fail(`autorun still too thick (${lines} lines) — expected thin <3600`);
  for (const needle of [
    'BA-style zones',
    'NORMAL PATH: JS PostBSMessage',
    'perform6-led-playback.json',
    'MaybePollLedPlaybackFile',
    'ApplyNativePlayback',
    'existence probe missed; trying PlayFile',
    'PlayLocalFile pool-direct OK',
    'ProbeString',
    'NO on-demand HTTPS stream',
    'media wipe DEFERRED',
    'FATAL soft-alive',
    'DeleteTreeBudgeted',
    'WriteBootCanary',
    'WriteMainHeartbeat',
    'roNodeJsEvent',
    'led-cache-prefetch ignored',
    'led-ota-install ignored',
    'led-storage-info-result',
    'led-log-tail',
    'load-error after HTML/bridge — reboot (no SetUrl)',
    'AtomicWriteAsciiFile',
    'Sub Main(',
    'FALLBACK',
  ]) {
    if (!text.includes(needle)) fail(`autorun.brs missing ${needle}`);
  }
  for (const banned of [
    'Sub HandleCacheEvent',
    'Sub HandleOtaEvent',
    'Sub StartCacheDownload',
    'Sub DrainMp4AliasQueueOne',
    'Function EnsureMp4PlayAlias',
    'Sub RecycleHtmlWidget',
    'DiagEchoInbound',
  ]) {
    if (text.includes(banned)) fail(`thin autorun must not contain ${banned}`);
  }
  if (!text.includes('profile = "XT2145" or profile = "XC4055"')) {
    fail('autorun must poll LED fallback bus for XT+XC');
  }
  for (const needle of [
    'Function BluefinVideoMode()',
    'return "1920x1080x60p:fullres"',
    'ledRect = CreateObject("roRectangle", bluefinW, 0, tileW, tileH)',
    'modeLed = SelectXtLedVideoMode(vm, displayMode)',
    'ConfigureOutput(sm[idx2], modeLed, bluefinW, true)',
    'OUT|EDID_SELECT|HDMI-2',
  ]) {
    if (!text.includes(needle)) fail(`XT safe mixed-resolution layout missing: ${needle}`);
  }
  ok(`autorun BA-style zones (${lines} lines)`);
}

function assertJs() {
  const led = fs.readFileSync(path.join(root, 'src', 'platform', 'ledPlaybackFile.ts'), 'utf8');
  if (!led.includes('writeLedPlaybackFile')) fail('ledPlaybackFile missing writer');
  if (!led.includes('toLedPlayableSrc')) fail('ledPlaybackFile must normalize via toLedPlayableSrc');
  if (!led.includes('FALLBACK')) fail('ledPlaybackFile must document SD as fallback');

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
  if (!xt.includes('BA-style') && !xt.includes('BA bridge')) {
    fail('XT bridge must be BA-style (PostBSMessage primary)');
  }
  if (!xt.includes('ack-timeout')) fail('XT bridge must SD-fallback on ack-timeout');
  if (!xt.includes('MEDIA|SOURCE|')) fail('XT bridge must report source media profile');

  const xc = fs.readFileSync(path.join(root, 'src', 'platform', 'xcOutputBridge.ts'), 'utf8');
  if (!xc.includes('PostBSMessage')) fail('XC bridge must PostBSMessage');
  if (!xc.includes('BA-style') && !xc.includes('BA bridge')) {
    fail('XC bridge must be BA-style (PostBSMessage primary)');
  }
  if (!xc.includes('ack-timeout')) fail('XC bridge must SD-fallback on ack-timeout');

  const port = fs.readFileSync(path.join(root, 'src', 'platform', 'bsMessagePort.ts'), 'utf8');
  if (!port.includes('isBridgeDuplexTransport')) {
    fail('bsMessagePort must expose isBridgeDuplexTransport');
  }

  const keepalive = fs.readFileSync(path.join(root, 'src', 'services', 'bridgeKeepalive.ts'), 'utf8');
  if (!keepalive.includes("BridgeLinkState = 'bridging'") && !keepalive.includes("'bridging' |")) {
    fail('bridgeKeepalive must expose bridging state during boot grace');
  }
  if (!keepalive.includes('BRIDGE_GRACE_MS') || !keepalive.includes('HELLO_RETRY_GRACE_MS')) {
    fail('bridgeKeepalive must define boot grace + fast hello retry');
  }
  if (!keepalive.includes('handshake grace') && !keepalive.includes('isBridgeInGrace')) {
    fail('bridgeKeepalive must skip heal/recycle during grace');
  }

  const store = fs.readFileSync(path.join(root, 'src', 'stores', 'runtimeStore.ts'), 'utf8');
  if (!store.includes('sanitizeDisplaySrc') || !store.includes('sanitizeFallbackSrc')) {
    fail('runtimeStore must sanitize display/fallback (no on-demand HTTPS)');
  }

  const playbackSrc = fs.readFileSync(path.join(root, 'src', 'services', 'playbackSrc.ts'), 'utf8');
  if (!playbackSrc.includes('no on-demand')) {
    fail('playbackSrc must document no on-demand HTTPS');
  }

  ok('JS BA-style bridge primary + SD fallback + no-on-demand gates');
}

assertPathRules();
assertAutorun();
assertJs();
console.log('[assert:led-playback] all checks passed');
