#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = '568f7b6e53b471a52588f8711505e433b538b8b9';
const allowedRuntimeFiles = new Set([
  '.env.brightsign-xt2145',
  'brightsign/autorun.brs',
  'ops/perform6-ota-bootstrap-1.5.12.html',
  'src/platform/ledPlaybackFile.ts',
  'src/platform/xtOutputBridge.ts',
  'src/components/home/HomeHeroVideo.tsx',
  'src/pages/Home.tsx',
  'src/services/bridgeKeepalive.ts',
  'src/services/deviceLogsApi.ts',
  'src/services/media.ts',
  'src/services/mediaAssetPool.ts',
  'src/services/mediaRealize.ts',
  'src/services/mediaStorePaths.ts',
  'src/services/otaApply.ts',
  'src/services/otaAssetPool.ts',
  'src/services/playbackSrc.ts',
  'src/services/playbackTelemetry.ts',
  'src/services/playbackTelemetryApi.ts',
  'src/services/sdCacheBridge.ts',
  'src/services/syncEngine.ts',
]);

function fail(message) {
  console.error(`[atlas-field-gate] FAIL: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const changed = git(['diff', '--name-only', baseline, '--'])
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.startsWith('scripts/') && file !== 'package.json');

for (const file of changed) {
  if (!allowedRuntimeFiles.has(file)) {
    fail(`unapproved runtime change relative to field-proven 1.5.8: ${file}`);
  }
}

for (const protectedPrefix of [
  'src/services/media',
  'src/services/sdCache',
  'src/services/program',
  'src/pages/',
  'src/stores/',
]) {
  if (
    changed.some(
      (file) =>
        file.startsWith(protectedPrefix) && !allowedRuntimeFiles.has(file),
    )
  ) {
    fail(`pairing/download/playback behavior changed under ${protectedPrefix}`);
  }
}

const autorun = fs.readFileSync(path.join(root, 'brightsign', 'autorun.brs'), 'utf8');
for (const marker of [
  'if profile = "XT2145" and multiOutput then',
  'TryCreateVideoPlayer(ledRect, msgPort, 2, "hdmi-2")',
  'TraceLog("MAIN|loop-enter")',
  'MaybePollLedPlaybackFile(ledStates, msgPort)',
  'if g.p6Profile = "XT2145" then return',
  'BRIDGE|ack-via-sd',
  'outbound boot post skipped',
  'Function RollbackPendingOta',
  'RollbackPendingOta("html-load-error")',
  'DeleteFile("SD:/perform6-ota-pending.json")',
  'MAIN|xt|workers-ready',
  'while not f.AtEof()',
  'existence probe missed; trying PlayFile',
]) {
  if (!autorun.includes(marker)) fail(`autorun invariant missing: ${marker}`);
}

const readRawFile = autorun.match(
  /Function ReadRawFile\(path as String\) as String([\s\S]*?)End Function/,
)?.[1];
if (!readRawFile || readRawFile.includes('while true')) {
  fail('ReadRawFile must terminate with roReadFile.AtEof()');
}


const mediaPool = fs.readFileSync(
  path.join(root, 'src', 'services', 'mediaAssetPool.ts'),
  'utf8',
);
for (const marker of [
  'event.detail',
  'POOL_START_MS = 10 * 60_000',
  'POOL_STALL_MS = 15 * 60_000',
]) {
  if (!mediaPool.includes(marker)) fail(`AssetPool field invariant missing: ${marker}`);
}

const media = fs.readFileSync(path.join(root, 'src', 'services', 'media.ts'), 'utf8');
for (const marker of [
  'realizeMediaAssetsViaRealizer',
  'AssetRealizer',
  'including assets downloaded by an earlier',
]) {
  if (!media.includes(marker)) fail(`AssetRealizer field invariant missing: ${marker}`);
}

const mediaRealize = fs.readFileSync(
  path.join(root, 'src', 'services', 'mediaRealize.ts'),
  'utf8',
);
for (const marker of ['emitSdCacheProgress', "status: 'done'", "status: 'skip'"]) {
  if (!mediaRealize.includes(marker)) {
    fail(`AssetRealizer completion notification missing: ${marker}`);
  }
}

const playbackPaths = fs.readFileSync(
  path.join(root, 'src', 'services', 'sdCacheBridge.ts'),
  'utf8',
);
const realizedIdx = playbackPaths.indexOf('const readyUrl = getSdCachedUrl(mediaVersionId)');
const poolIdx = playbackPaths.indexOf('const poolPath = getMediaPoolPath(mediaVersionId)', realizedIdx);
if (realizedIdx < 0 || poolIdx < 0 || realizedIdx > poolIdx) {
  fail('realized .mp4 must be preferred before extensionless pool fallback');
}

const xtBridge = fs.readFileSync(
  path.join(root, 'src', 'platform', 'xtOutputBridge.ts'),
  'utf8',
);
for (const marker of [
  "'start-here': 'SCREEN_2'",
  "phase1: 'SCREEN_3'",
  "phase2: 'SCREEN_4'",
  "'full-program': 'SCREEN_5'",
  "source: 'NATIVE_HDMI'",
  "output: 'HDMI-2'",
  'reportNativeHdmiTelemetry(status)',
]) {
  if (!xtBridge.includes(marker)) {
    fail(`XT native HDMI telemetry invariant missing: ${marker}`);
  }
}

const homeHero = fs.readFileSync(
  path.join(root, 'src', 'components', 'home', 'HomeHeroVideo.tsx'),
  'utf8',
);
for (const marker of [
  'useVideoPlaybackTelemetry(',
  "screenKey: 'SCREEN_1'",
  'mediaVersionId',
]) {
  if (!homeHero.includes(marker)) {
    fail(`Bluefin HDMI-1 telemetry invariant missing: ${marker}`);
  }
}

const env = fs.readFileSync(path.join(root, '.env.brightsign-xt2145'), 'utf8');
if (!env.includes('https://perform6-api-atlas-production.up.railway.app/api/v1')) {
  fail('XT candidate is not bound to the isolated Atlas API');
}
if (env.includes('https://portal.perform6.com/api/v1')) {
  fail('XT candidate still contains the production API endpoint');
}

const otaApply = fs.readFileSync(path.join(root, 'src/services/otaApply.ts'), 'utf8');
const otaPool = fs.readFileSync(path.join(root, 'src/services/otaAssetPool.ts'), 'utf8');
for (const marker of [
  "if (p === 'autorun.brs') return 3",
  "req('@brightsign/assetrealizer')",
  'validateFiles(assetList, { deleteCorrupt: false })',
  'perform6-ota-pending.json',
  'perform6-recovery',
  'refusing unsafe pool copy',
  'rebootViaBrightSignSystem()',
  'fs.renameSync(temporary, destination)',
]) {
  if (!otaApply.includes(marker) && !otaPool.includes(marker)) {
    fail(`recoverable OTA invariant missing: ${marker}`);
  }
}

console.log('[atlas-field-gate] PASS: protected 1.5.8 behavior is unchanged');
console.log(`[atlas-field-gate] allowed runtime delta: ${changed.join(', ')}`);
