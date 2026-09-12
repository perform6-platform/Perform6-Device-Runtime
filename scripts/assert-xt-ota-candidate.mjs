#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeBaseline = 'c7011b5';
const version = process.argv[2];
const packageFolder = process.argv[3]
  ? path.resolve(root, process.argv[3])
  : version
    ? path.join(root, 'releases', 'xt2145', `perform6-xt2145-${version}`)
    : '';
const zipPath = process.argv[4]
  ? path.resolve(root, process.argv[4])
  : version
    ? `${packageFolder}.zip`
    : '';

function fail(message) {
  console.error(`[xt-ota-safety] FAIL: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
  });
}

function sha256(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function listFiles(folder, relative = '') {
  const result = [];
  for (const name of fs.readdirSync(path.join(folder, relative)).sort()) {
    const rel = path.posix.join(relative, name);
    const absolute = path.join(folder, rel);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symbolic link is forbidden in OTA package: ${rel}`);
    if (stat.isDirectory()) result.push(...listFiles(folder, rel));
    else if (stat.isFile()) result.push(rel);
    else fail(`unsupported package entry: ${rel}`);
  }
  return result;
}

const brightScriptBuiltins = new Set(
  [
    'asc', 'chr', 'copyfile', 'createdirectory', 'createobject',
    'deletedirectory', 'deletefile', 'formatjson', 'getglobalaa', 'instr',
    'int', 'lcase', 'left', 'len', 'matchfiles', 'mid', 'movefile',
    'parsejson', 'readasciifile', 'right', 'sleep', 'str', 'stri', 'type',
    'ucase', 'val', 'wait', 'writeasciifile',
  ],
);

function unresolvedBrightScriptCalls(source) {
  const definitions = new Set(
    [...source.matchAll(/^\s*(?:Function|Sub)\s+([A-Za-z_]\w*)\s*\(/gim)]
      .map((match) => match[1].toLowerCase()),
  );
  const code = source
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/'.*$/gm, '');
  const calls = new Set();
  for (const match of code.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)) {
    calls.add(match[1]);
  }
  const keywords = new Set(['if', 'for', 'while', 'function', 'sub', 'return']);
  return [...calls]
    .filter((name) => {
      const lower = name.toLowerCase();
      return !definitions.has(lower) && !brightScriptBuiltins.has(lower) && !keywords.has(lower);
    })
    .sort();
}

if (!version || !packageFolder || !zipPath) {
  fail('usage: node scripts/assert-xt-ota-candidate.mjs <version> [package-folder] [zip]');
}
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`invalid semantic version: ${version}`);
if (!fs.existsSync(packageFolder)) fail(`package folder missing: ${packageFolder}`);
if (!fs.existsSync(zipPath)) fail(`package ZIP missing: ${zipPath}`);

try {
  execFileSync('git', ['merge-base', '--is-ancestor', safeBaseline, 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  fail(`HEAD is not descended from safe baseline ${safeBaseline}`);
}

// This clean-card release may change only the media-pool bootstrap. Startup,
// OTA, heartbeat, recovery, playback and UI control remain the field-proven
// 1.5.23 implementation.
const allowedRuntimeDelta = new Set([
  'src/services/assetPoolBootstrap.ts',
  'src/services/mediaAssetPool.ts',
]);
const changedRuntime = git(['diff', '--name-only', safeBaseline, '--'])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => file.startsWith('src/') || file.startsWith('brightsign/'));
for (const file of changedRuntime) {
  if (!allowedRuntimeDelta.has(file)) {
    fail(`unreviewed runtime delta relative to 1.5.23: ${file}`);
  }
}
for (const required of allowedRuntimeDelta) {
  if (!changedRuntime.includes(required)) fail(`expected reviewed runtime delta missing: ${required}`);
}

const sourceAutorun = fs.readFileSync(path.join(root, 'brightsign', 'autorun.brs'));
const baselineAutorun = git(['show', `${safeBaseline}:brightsign/autorun.brs`], {
  encoding: 'buffer',
});
if (!sourceAutorun.equals(baselineAutorun)) {
  fail('autorun.brs is not byte-identical to the field-proven 1.5.23 baseline');
}

const unresolved = unresolvedBrightScriptCalls(sourceAutorun.toString('utf8'));
if (unresolved.length) fail(`unresolved BrightScript call(s): ${unresolved.join(', ')}`);

// Prove the checker catches the real 1.5.33 outage rather than merely passing
// the current candidate. JsonEscape was called but never defined there.
const failedAutorun = fs.readFileSync(
  path.join(root, 'scripts', 'fixtures', 'autorun-1.5.33-undefined-jsonescape.brs'),
  'utf8',
);
const failedUnresolved = unresolvedBrightScriptCalls(failedAutorun);
if (!failedUnresolved.some((name) => name.toLowerCase() === 'jsonescape')) {
  fail('1.5.33 regression fixture did not detect unresolved JsonEscape');
}

const expectedFiles = new Set([
  'README-SD.txt',
  'assets/Inter-Bold-Sckx8rpT.woff2',
  'assets/Inter-Medium-D2bGa7uu.woff2',
  'assets/Inter-Regular-BOOGhInR.woff2',
  'assets/Inter-SemiBold-D273HNI0.woff2',
  'assets/Perform_6_trademark-ClFD9aGP.png',
  'assets/app.js',
  'assets/style.css',
  'autorun.brs',
  'index.html',
  'led-idle.png',
  'perform6-display.txt',
  'perform6-ops.emergency.json',
  'perform6-ops.json',
  'perform6-profile.txt',
  'perform6-release.json',
]);
const folderFiles = listFiles(packageFolder);
for (const file of folderFiles) {
  if (!expectedFiles.has(file)) fail(`unexpected packaged file: ${file}`);
}
for (const file of expectedFiles) {
  if (!folderFiles.includes(file)) fail(`required packaged file missing: ${file}`);
}

const packageAutorun = fs.readFileSync(path.join(packageFolder, 'autorun.brs'));
if (!packageAutorun.equals(baselineAutorun)) {
  fail('packaged autorun differs from field-proven 1.5.23');
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(packageFolder, 'perform6-release.json'), 'utf8'),
);
if (manifest.profile !== 'XT2145' || manifest.version !== version) {
  fail(`manifest identity mismatch: ${manifest.profile ?? '?'} ${manifest.version ?? '?'}`);
}
if (manifest.storageEncryption?.enabled !== false) {
  fail('storage encryption must remain disabled for the clean-card pool test');
}
if (fs.readFileSync(path.join(packageFolder, 'perform6-profile.txt'), 'utf8').trim() !== 'XT2145') {
  fail('packaged hardware profile is not XT2145');
}

for (const [file, banned] of [
  ['autorun.brs', ['encryptstorage', 'formatstorage', 'formatfilesystem', 'jsonescape']],
  ['assets/app.js', ['encryptstorage', 'perform6-sd-encryption']],
]) {
  const body = fs.readFileSync(path.join(packageFolder, file), 'utf8').toLowerCase();
  for (const needle of banned) {
    if (body.includes(needle)) fail(`forbidden ${needle} present in packaged ${file}`);
  }
}

const ops = JSON.parse(fs.readFileSync(path.join(packageFolder, 'perform6-ops.json'), 'utf8'));
for (const unsafeFlag of ['clearCacheOnBoot', 'syncOnBoot', 'rebootAfterCacheClear']) {
  if (ops[unsafeFlag] === true) fail(`unsafe default operation enabled: ${unsafeFlag}`);
}
if (ops.pauseOta !== true) fail('pauseOta must default true so installation remains admin-triggered');

const zipRoot = `${path.basename(packageFolder)}/`;
const zipEntries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter((entry) => entry && !entry.endsWith('/'));
const normalizedZipFiles = zipEntries.map((entry) => {
  if (!entry.startsWith(zipRoot)) fail(`ZIP entry escapes expected package root: ${entry}`);
  const rel = entry.slice(zipRoot.length);
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) {
    fail(`unsafe ZIP path: ${entry}`);
  }
  return rel;
});
if (new Set(normalizedZipFiles).size !== normalizedZipFiles.length) {
  fail('ZIP contains duplicate file entries');
}
if (normalizedZipFiles.length !== folderFiles.length) fail('ZIP/folder file count mismatch');
for (const rel of folderFiles) {
  if (!normalizedZipFiles.includes(rel)) fail(`ZIP missing folder file: ${rel}`);
  const zipped = execFileSync('unzip', ['-p', zipPath, `${zipRoot}${rel}`]);
  const local = fs.readFileSync(path.join(packageFolder, rel));
  if (sha256(zipped) !== sha256(local)) fail(`ZIP content mismatch: ${rel}`);
}

console.log('[xt-ota-safety] PASS: packaged ZIP exactly matches the inspected folder');
console.log('[xt-ota-safety] PASS: autorun is byte-identical to field-proven 1.5.23');
console.log('[xt-ota-safety] PASS: unresolved BrightScript calls = 0');
console.log('[xt-ota-safety] PASS: historical 1.5.33 JsonEscape failure is detected');
console.log('[xt-ota-safety] PASS: encryption, formatting, cache wipe, sync-on-boot and auto-OTA are disabled');
console.log(`[xt-ota-safety] candidate sha256=${sha256(fs.readFileSync(zipPath))}`);
