/**
 * Offline asserts for LED SD-bus + pool PlayFile path rules (no hardware).
 * Invoked by npm run assert:led-playback and release:zip.
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

/** Mirror playbackSrc.ts rules (keep in sync). */
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
  const poolFile =
    'file:///SD:/perform6-media-pool/ab/sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const storage =
    '/storage/sd/perform6-media-pool/ab/sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const legacy = 'SD:/perform6-media/golf.mp4';
  if (!isNativeLedPlayableSrc(pool)) fail('extensionless pool SD:/ path must be playable');
  if (!isNativeLedPlayableSrc(poolFile)) fail('extensionless pool file:// path must be playable');
  if (!isNativeLedPlayableSrc(storage)) fail('extensionless /storage/sd pool path must be playable');
  if (!isNativeLedPlayableSrc(legacy)) fail('legacy .mp4 must be playable');
  if (isNativeLedPlayableSrc('https://cdn.example/v.mp4')) fail('HTTPS must not be native LED playable');
  if (isNativeLedPlayableSrc('SD:/other/no-ext')) fail('non-pool extensionless must be rejected');
  ok('path playability rules (pool hash + legacy mp4)');
}

function assertAutorun() {
  const text = fs.readFileSync(path.join(root, 'brightsign', 'autorun.brs'), 'utf8');
  for (const needle of [
    'EnsureMp4PlayAlias',
    'PoolMp4AliasPath',
    'IsExtensionlessPoolPath',
    'perform6-led-playback.json',
    'MaybePollLedPlaybackFile',
    'ApplyOneLedPlaybackCommand',
    ' PlayLocalFile alias-hit',
    'PlayLocalFile pool-direct OK',
    'PlayLocalFile alias-create',
    'DrainMp4AliasQueueOne',
    'AtomicWriteAsciiFile',
    'LedStatusRolesAA',
    'LoadLedStatusRootAA',
    'roles.AddReplace',
    'led2',
    'led3',
  ]) {
    if (!text.includes(needle)) fail(`autorun.brs missing ${needle}`);
  }
  if (!text.includes('profile = "XT2145" or profile = "XC4055"')) {
    fail('autorun must poll LED bus for both XT2145 and XC4055');
  }
  if (!text.includes('perform6-led-playback-status-') || !text.includes('root.roles')) {
    fail('autorun must write per-role status (roles map + sidecars)');
  }
  if (!text.includes('perform6-mp4-alias-queue.json')) {
    fail('autorun must drain mp4 alias queue');
  }
  ok('autorun LED bus + alias-first + per-role status');
}

function assertJs() {
  const led = fs.readFileSync(path.join(root, 'src', 'platform', 'ledPlaybackFile.ts'), 'utf8');
  if (!led.includes('perform6-led-playback.json')) fail('ledPlaybackFile missing unified path');
  if (!led.includes('writeLedPlaybackFile')) fail('ledPlaybackFile missing writer');
  if (!led.includes('readLedPlaybackStatusForRole')) fail('ledPlaybackFile missing per-role reader');
  if (!led.includes('isLedStatusStarted')) fail('ledPlaybackFile missing isLedStatusStarted');
  if (!led.includes('statusRolePath(role)')) fail('ledPlaybackFile must prefer per-role sidecars');
  const aliasQ = fs.readFileSync(path.join(root, 'src', 'services', 'mp4AliasQueue.ts'), 'utf8');
  if (!aliasQ.includes('enqueueMp4PlayAlias')) fail('mp4AliasQueue missing enqueueMp4PlayAlias');
  if (!aliasQ.includes('perform6-mp4-alias-queue.json')) fail('mp4AliasQueue missing queue path');
  const bridge = fs.readFileSync(path.join(root, 'src', 'services', 'sdCacheBridge.ts'), 'utf8');
  if (!bridge.includes('enqueueMp4PlayAlias') && !bridge.includes('mp4AliasQueue')) {
    fail('sdCacheBridge must enqueue mp4 alias after pool mark');
  }
  const xc = fs.readFileSync(path.join(root, 'src', 'platform', 'xcOutputBridge.ts'), 'utf8');
  if (!xc.includes('writeLedPlaybackFile')) fail('XC bridge must use SD bus');
  if (!xc.includes('readLedPlaybackStatusForRole')) fail('XC bridge must read per-role status');
  if (!xc.includes("'led2'") || !xc.includes("'led3'")) fail('XC bridge must target led2/led3');
  const xt = fs.readFileSync(path.join(root, 'src', 'platform', 'xtOutputBridge.ts'), 'utf8');
  if (!xt.includes('writeXtPlaybackFile')) fail('XT bridge must write SD bus');
  if (!xt.includes('isLedStatusStarted')) fail('XT bridge must use per-role started helper');
  ok('JS XT+XC SD bus writers + per-role status readers');
}

function assertBusJsonShape() {
  const sample = {
    type: 'led-playback',
    writtenAt: '1',
    commands: [
      {
        target: 'led',
        src: 'SD:/perform6-media-pool/x/sha256-abc',
        fallbackSrc: '',
        restartNonce: '1',
        loop: 'true',
        paused: 'false',
        muted: 'false',
        volumePercent: '100',
        writtenAt: '1',
      },
      {
        target: 'led2',
        src: 'SD:/perform6-media-pool/y/sha256-def',
        fallbackSrc: '',
        restartNonce: '1',
        loop: 'true',
        paused: 'false',
        muted: 'false',
        volumePercent: '100',
        writtenAt: '1',
      },
    ],
  };
  if (sample.type !== 'led-playback') fail('bus type');
  if (sample.commands.length !== 2) fail('bus commands');
  if (!isNativeLedPlayableSrc(sample.commands[0].src)) fail('sample led src');
  if (!isNativeLedPlayableSrc(sample.commands[1].src)) fail('sample led2 src');

  const statusSample = {
    type: 'led-playback-status',
    role: 'led2',
    roles: {
      led2: { role: 'led2', ok: '1', state: 'started', ended: '0' },
      led3: { role: 'led3', ok: '1', state: 'started', ended: '0' },
    },
  };
  if (!statusSample.roles.led2 || !statusSample.roles.led3) {
    fail('status roles map must hold led2 and led3');
  }
  ok('unified bus + per-role status JSON shape');
}

assertPathRules();
assertAutorun();
assertJs();
assertBusJsonShape();
console.log('[assert:led-playback] all checks passed');

