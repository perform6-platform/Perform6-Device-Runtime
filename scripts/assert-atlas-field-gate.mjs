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
  'src/platform/ledPlaybackFile.ts',
  'src/platform/xtOutputBridge.ts',
  'src/services/mediaAssetPool.ts',
  'src/services/otaApply.ts',
  'src/services/otaAssetPool.ts',
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
        file.startsWith(protectedPrefix) && file !== 'src/services/mediaAssetPool.ts',
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
]) {
  if (!autorun.includes(marker)) fail(`autorun invariant missing: ${marker}`);
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
]) {
  if (!otaApply.includes(marker) && !otaPool.includes(marker)) {
    fail(`recoverable OTA invariant missing: ${marker}`);
  }
}

console.log('[atlas-field-gate] PASS: protected 1.5.8 behavior is unchanged');
console.log(`[atlas-field-gate] allowed runtime delta: ${changed.join(', ')}`);
