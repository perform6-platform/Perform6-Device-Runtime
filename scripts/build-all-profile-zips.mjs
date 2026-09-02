#!/usr/bin/env node
/**
 * Build BrightSign packages (ready folder + ZIP) for XT2145, XC4055, and HD226 (DEVICE_A default).
 * Also copies every profile package into releases/all/perform6-<version>/ for one-stop deploy.
 *
 * Usage: node scripts/build-all-profile-zips.mjs [version]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] || process.env.npm_package_version || '0.1.0';
const script = path.join(root, 'scripts', 'build-profile-zip.mjs');

const PROFILES = [
  { key: 'XT2145', slug: 'xt2145', member: '' },
  { key: 'XC4055', slug: 'xc4055', member: '' },
  { key: 'HD226', slug: 'hd226', member: 'device_a' },
];

function packageBase(slug, member) {
  const memberSuffix = member ? `-${member}` : '';
  return `perform6-${slug}${memberSuffix}-${version}`;
}

for (const profile of ['XT2145', 'XC4055', 'HD226']) {
  const result = spawnSync(process.execPath, [script, profile, version], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const allDir = path.join(root, 'releases', 'all', `perform6-${version}`);
if (fs.existsSync(allDir)) {
  fs.rmSync(allDir, { recursive: true, force: true });
}
fs.mkdirSync(allDir, { recursive: true });

const lines = [
  `Perform6 — all device packages (version ${version})`,
  '',
  'Use ONLY the zip/folder that matches your hardware:',
  '',
];

for (const profile of PROFILES) {
  const base = packageBase(profile.slug, profile.member);
  const srcZip = path.join(root, 'releases', profile.slug, `${base}.zip`);
  const srcFolder = path.join(root, 'releases', profile.slug, base);
  const destZip = path.join(allDir, `${base}.zip`);
  const destFolder = path.join(allDir, base);

  if (!fs.existsSync(srcZip)) {
    console.error(`[release:zip:all] Missing ${srcZip}`);
    process.exit(1);
  }
  fs.copyFileSync(srcZip, destZip);

  if (fs.existsSync(srcFolder)) {
    fs.cpSync(srcFolder, destFolder, { recursive: true });
  }

  lines.push(`  ${profile.key.padEnd(8)} → ${base}.zip`);
  console.log(`[release:zip:all] Bundled ${profile.key} → ${path.relative(root, destZip)}`);
}

lines.push(
  '',
  'SD deploy: extract the matching zip, copy CONTENTS to SD card root, reboot.',
  'Do NOT mix files from different device packages.',
  '',
  'Individual profile builds also remain under releases/xt2145/, xc4055/, hd226/.',
);

fs.writeFileSync(path.join(allDir, 'README-ALL-DEVICES.txt'), lines.join('\n'));

console.log(`\n[release:zip:all] All devices together: ${path.relative(root, allDir)}`);
console.log(`[release:zip:all] Done — releases/*/perform6-*-${version}/ + R2 upload (unless SKIP_R2_UPLOAD=1)`);
