#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Production 1.5.21 merge: pairing, OTA, downloads and HDMI-2 playback were
// field-validated on Gabe's XT2145. Only the reviewed 4K diagnostics and
// non-destructive clean-card AssetPool bootstrap deltas are allowed beyond
// this point.
const baseline = '8462d696cbc6cace659ea640ffd4a604cdc4d66b';
const allowedRuntimeFiles = new Set([
  'brightsign/autorun.brs',
  'docs/XT2145-CLEAN-CARD-ENCRYPTION-FIELD-GATE.md',
  'scripts/assert-led-playback.mjs',
  'scripts/build-profile-zip.mjs',
  'src/App.tsx',
  'src/components/status/OutputDiagnostics.tsx',
  'src/hooks/useVideoPlaybackTelemetry.ts',
  'src/layout/BluefinMasterFrame.tsx',
  'src/main.tsx',
  'src/pages/display/XC4055Display.tsx',
  'src/pages/display/XT2145Display.tsx',
  'src/platform/xcOutputBridge.ts',
  'src/platform/xtOutputBridge.ts',
  'src/platform/bsMessagePort.ts',
  'src/platform/ledPlaybackFile.ts',
  'src/services/autorunCapabilities.ts',
  'src/services/autorunDiag.ts',
  'src/services/bridgeKeepalive.ts',
  'src/services/deviceLogsApi.ts',
  'src/services/assetPoolBootstrap.ts',
  'src/services/mediaAssetPool.ts',
  'src/services/mediaEncryption.ts',
  'src/services/otaAssetPool.ts',
  'src/services/outputResolutionProbe.ts',
  'src/services/sync.ts',
  'src/services/syncEngine.ts',
  'src/shared/types/api.ts',
  'src/shared/bluefinViewport.ts',
]);

// Retained only as evidence for the completed 1.5.44–1.5.46 lab probes.
// The release builder packages none of these into current candidates.
const historicalLabOnly = new Set([
  'brightsign/encryption-test/perform6-encrypted-probe.p6enc',
  'src/services/encryptedPlaybackInteropProbe.ts',
  'src/services/mediaKeyInteropProbe.ts',
]);

function fail(message) {
  console.error(`[production-field-gate] FAIL: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const changed = git(['diff', '--name-only', baseline, '--'])
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.startsWith('scripts/') && file !== 'package.json')
  .filter((file) => !historicalLabOnly.has(file));

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
  "const screenKey = 'SCREEN_2'",
  "source: 'NATIVE_HDMI'",
  "output: 'HDMI-2 native (configured 3840x2160x60p)'",
  'reportNativeHdmiTelemetry(status)',
]) {
  if (!xtBridge.includes(marker)) {
    fail(`XT native HDMI telemetry invariant missing: ${marker}`);
  }
}
for (const obsolete of [
  "phase1: 'SCREEN_3'",
  "phase2: 'SCREEN_4'",
  "'full-program': 'SCREEN_5'",
]) {
  if (xtBridge.includes(obsolete)) {
    fail(`XT program slot still masquerades as a physical output: ${obsolete}`);
  }
}

const releaseBuilder = fs.readFileSync(
  path.join(root, 'scripts', 'build-profile-zip.mjs'),
  'utf8',
);
if (!releaseBuilder.includes("version === '1.5.45' || version === '1.5.46'")) {
  fail('historical encrypted fixture packaging is not constrained to completed lab versions');
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
if (!env.includes('https://portal.perform6.com/api/v1')) {
  fail('XT candidate is not bound to the established Perform6 production API');
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

console.log('[production-field-gate] PASS: protected production 1.5.21 behavior is unchanged');
console.log(`[production-field-gate] allowed runtime delta: ${changed.join(', ')}`);
