#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = 'c7011b5';

function fail(message) {
  console.error(`[clean-card-media] FAIL: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

for (const protectedFile of [
  'brightsign/autorun.brs',
  'src/services/ota.ts',
  'src/services/otaApply.ts',
  'src/services/otaAssetPool.ts',
  'src/services/heartbeat.ts',
]) {
  const current = fs.readFileSync(path.join(root, protectedFile));
  const baselineBody = execFileSync('git', ['show', `${baseline}:${protectedFile}`], {
    cwd: root,
  });
  if (!current.equals(baselineBody)) {
    fail(`protected startup/OTA file changed: ${protectedFile}`);
  }
}

const bootstrap = fs.readFileSync(
  path.join(root, 'src/services/assetPoolBootstrap.ts'),
  'utf8',
);
for (const required of [
  'fs.existsSync(path)',
  'fs.statSync(path).isDirectory()',
  'fs.mkdirSync(path, { recursive: true })',
]) {
  if (!bootstrap.includes(required)) fail(`bootstrap invariant missing: ${required}`);
}
for (const destructive of ['unlinkSync', 'rmSync', 'rmdirSync', 'writeFileSync']) {
  if (bootstrap.includes(destructive)) {
    fail(`clean-card bootstrap must remain non-destructive: ${destructive}`);
  }
}

const { ensureAssetPoolDirectory } = await import(
  pathToFileURL(path.join(root, 'src/services/assetPoolBootstrap.ts')).href
);

function fakeFs(initialKind = 'missing', mkdirError = null) {
  let kind = initialKind;
  let mkdirCalls = 0;
  return {
    fs: {
      existsSync: () => kind !== 'missing',
      statSync: () => ({
        size: 0,
        isDirectory: () => kind === 'directory',
        isFile: () => kind === 'file',
      }),
      mkdirSync: () => {
        mkdirCalls += 1;
        if (mkdirError) throw mkdirError;
        kind = 'directory';
      },
    },
    mkdirCalls: () => mkdirCalls,
  };
}

const emptyCard = fakeFs('missing');
const created = ensureAssetPoolDirectory(emptyCard.fs, '/storage/sd/perform6-media-pool');
if (!created.ready || !created.created || emptyCard.mkdirCalls() !== 1) {
  fail('empty-card directory creation model failed');
}

const populatedCard = fakeFs('directory');
const preserved = ensureAssetPoolDirectory(
  populatedCard.fs,
  '/storage/sd/perform6-media-pool',
);
if (!preserved.ready || preserved.created || populatedCard.mkdirCalls() !== 0) {
  fail('existing AssetPool must remain untouched');
}

const pathCollision = fakeFs('file');
const collision = ensureAssetPoolDirectory(
  pathCollision.fs,
  '/storage/sd/perform6-media-pool',
);
if (collision.ready || pathCollision.mkdirCalls() !== 0) {
  fail('file collision must fail closed without mutation');
}

const media = fs.readFileSync(path.join(root, 'src/services/mediaAssetPool.ts'), 'utf8');
for (const required of [
  'ensureAssetPoolDirectory(getNodeFs(), MEDIA_POOL_PATH)',
  'getFailureReason',
  'collectionFailureCode',
  'origins: downloadOrigins(needFetch)',
]) {
  if (!media.includes(required)) fail(`media diagnostic invariant missing: ${required}`);
}

const fieldGate = fs.readFileSync(
  path.join(root, 'docs/XT2145-CLEAN-CARD-ENCRYPTION-FIELD-GATE.md'),
  'utf8',
);
for (const required of [
  'Gabe must not be required for recovery',
  'retain authenticated heartbeat, diagnostics, and OTA control',
  '**Default** and **Start Here**',
  '**Phase 1**, **Phase 2**, and **Full Program**',
  'No full-library replacement',
  '+ecryptfs',
]) {
  if (!fieldGate.includes(required)) fail(`field sequence missing: ${required}`);
}

console.log('[clean-card-media] PASS: clean-card pool bootstrap is non-destructive');
console.log('[clean-card-media] PASS: 1.5.23 startup, heartbeat, and OTA files are unchanged');
console.log('[clean-card-media] PASS: native AssetPool failure diagnostics are retained');
