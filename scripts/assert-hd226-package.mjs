#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { assertPosixZipPaths } from './posix-zip.mjs';

const version = process.argv[2];
const member = (process.argv[3] || 'DEVICE_A').toUpperCase();
const packageFolder = process.argv[4] ? path.resolve(process.argv[4]) : '';
const zipPath = process.argv[5] ? path.resolve(process.argv[5]) : '';

function fail(message) {
  console.error(`[hd226-package] FAIL: ${message}`);
  process.exit(1);
}

if (!version || !packageFolder || !zipPath) {
  fail('usage: node scripts/assert-hd226-package.mjs <version> <DEVICE_A> <folder> <zip>');
}

const required = [
  'README-SD.txt',
  'autorun.brs',
  'index.html',
  'assets/app.js',
  'assets/style.css',
  'images/perform6-approved-logo.svg',
  'perform6-display.txt',
  'perform6-ops.emergency.json',
  'perform6-ops.json',
  'perform6-profile.txt',
  'perform6-release.json',
];

function listFiles(folder, relative = '') {
  const result = [];
  for (const name of fs.readdirSync(path.join(folder, relative)).sort()) {
    const rel = path.posix.join(relative, name);
    if (rel.includes('\\')) fail(`package path uses a Windows separator: ${rel}`);
    const absolute = path.join(folder, rel);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symbolic link is forbidden: ${rel}`);
    if (stat.isDirectory()) result.push(...listFiles(folder, rel));
    else if (stat.isFile()) result.push(rel);
    else fail(`unsupported package entry: ${rel}`);
  }
  return result;
}

const files = listFiles(packageFolder);
for (const file of required) {
  if (!files.includes(file)) fail(`required packaged file missing: ${file}`);
}
if (files.includes('led-idle.png')) {
  fail('HD226 package must not include the XT/XC led-idle.png');
}

if (fs.readFileSync(path.join(packageFolder, 'perform6-profile.txt'), 'utf8').trim() !== 'HD226') {
  fail('perform6-profile.txt is not HD226');
}
const index = fs.readFileSync(path.join(packageFolder, 'index.html'), 'utf8');
if (!index.includes('./images/perform6-approved-logo.svg')) {
  fail('boot shell does not use the approved logo');
}
const ops = JSON.parse(fs.readFileSync(path.join(packageFolder, 'perform6-ops.json'), 'utf8'));
if (ops.pauseOta !== true) fail('pauseOta must default true');
for (const flag of ['clearCacheOnBoot', 'syncOnBoot', 'rebootAfterCacheClear']) {
  if (ops[flag] === true) fail(`unsafe default operation enabled: ${flag}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(packageFolder, 'perform6-release.json'), 'utf8'));
if (manifest.profile !== 'HD226') fail(`manifest profile is ${manifest.profile ?? '?'}`);
if (manifest.version !== version) fail(`manifest version is ${manifest.version ?? '?'}`);
if (manifest.clusterMember !== member) {
  fail(`manifest member is ${manifest.clusterMember ?? '?'}, expected ${member}`);
}

let zipNames;
try {
  zipNames = assertPosixZipPaths(zipPath);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const zipRoot = `${path.basename(packageFolder)}/`;
const zipFiles = zipNames
  .filter((name) => !name.endsWith('/'))
  .map((name) => {
    if (!name.startsWith(zipRoot)) fail(`ZIP entry escapes package root: ${name}`);
    return name.slice(zipRoot.length);
  });
for (const file of required) {
  if (!zipFiles.includes(file)) fail(`ZIP missing ${file}`);
}

console.log(`[hd226-package] PASS: HD226 ${version} ${member} uses / paths and the approved boot logo`);
