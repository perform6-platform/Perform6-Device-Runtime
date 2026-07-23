#!/usr/bin/env node
/**
 * Build a BrightSign SD-card ZIP for one hardware profile.
 *
 * Usage:
 *   node scripts/build-profile-zip.mjs <XT2145|XC4055|HD226> [version] [CLUSTER_MEMBER]
 *
 * Examples:
 *   node scripts/build-profile-zip.mjs XT2145 1.0.0
 *   node scripts/build-profile-zip.mjs HD226 1.0.0 DEVICE_B
 *
 * Output: releases/<profile-lower>/perform6-<profile-lower>[-member]-<version>.zip
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PROFILES = {
  XT2145: {
    mode: 'brightsign-xt2145',
    slug: 'xt2145',
  },
  XC4055: {
    mode: 'brightsign-xc4055',
    slug: 'xc4055',
  },
  HD226: {
    mode: 'brightsign-hd226',
    slug: 'hd226',
  },
};

const CLUSTER_MEMBERS = [
  'DEVICE_A',
  'DEVICE_B',
  'DEVICE_C',
  'DEVICE_D',
  'DEVICE_E',
  'DEVICE_F',
  'DEVICE_G',
  'DEVICE_H',
  'DEVICE_I',
  'DEVICE_J',
];

function fail(message) {
  console.error(`\n[release:zip] ${message}\n`);
  process.exit(1);
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function zipDirectory(sourceDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  if (process.platform === 'win32') {
    const ps = [
      'Compress-Archive',
      '-Path',
      `"${path.join(sourceDir, '*')}"`,
      '-DestinationPath',
      `"${zipPath}"`,
      '-Force',
    ].join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.status !== 0) fail(`PowerShell Compress-Archive failed for ${zipPath}`);
    return;
  }

  const result = spawnSync('zip', ['-r', zipPath, '.'], {
    cwd: sourceDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail(`zip failed for ${zipPath} (is "zip" installed?)`);
}

function main() {
  const profileKey = (process.argv[2] || '').toUpperCase();
  const version = process.argv[3] || process.env.npm_package_version || '0.1.0';
  const memberArg = (process.argv[4] || '').toUpperCase();

  const profile = PROFILES[profileKey];
  if (!profile) {
    fail(
      `Unknown profile "${process.argv[2]}". Use: XT2145 | XC4055 | HD226\n` +
        `  npm run release:zip:xt2145 -- ${version}\n` +
        `  npm run release:zip:xc4055 -- ${version}\n` +
        `  npm run release:zip:hd226 -- ${version} [DEVICE_A]`,
    );
  }

  if (memberArg && profileKey !== 'HD226') {
    fail(`Cluster member is only valid for HD226 (got ${memberArg})`);
  }
  if (memberArg && !CLUSTER_MEMBERS.includes(memberArg)) {
    fail(`Invalid cluster member "${memberArg}". Use DEVICE_A … DEVICE_J`);
  }

  const envFile = path.join(root, `.env.${profile.mode}`);
  if (!fs.existsSync(envFile)) {
    fail(`Missing env file: ${envFile}`);
  }

  const member = profileKey === 'HD226' ? memberArg || 'DEVICE_A' : '';
  const memberSuffix = member ? `-${member.toLowerCase()}` : '';
  const outName = `perform6-${profile.slug}${memberSuffix}-${version}.zip`;
  const outDir = path.join(root, 'releases', profile.slug);
  const outZip = path.join(outDir, outName);

  console.log(`[release:zip] profile=${profileKey} version=${version}` +
    (member ? ` member=${member}` : ''));
  console.log(`[release:zip] mode=${profile.mode}`);
  console.log(`[release:zip] api from ${path.basename(envFile)} (edit VITE_API_BASE_URL for production)`);

  const buildEnv = {};
  if (member) {
    buildEnv.VITE_CLUSTER_MEMBER = member;
  }
  // Keep runtime version aligned with ZIP version when provided.
  buildEnv.VITE_RUNTIME_VERSION = version;

  const viteBin = path.join(
    root,
    'node_modules',
    'vite',
    'bin',
    'vite.js',
  );
  run(process.execPath, [viteBin, 'build', '--mode', profile.mode], buildEnv);

  const distIndex = path.join(root, 'dist', 'index.html');
  const distAssets = path.join(root, 'dist', 'assets');
  const autorun = path.join(root, 'brightsign', 'autorun.brs');
  if (!fs.existsSync(distIndex) || !fs.existsSync(distAssets) || !fs.existsSync(autorun)) {
    fail('Build output incomplete (need dist/index.html, dist/assets, brightsign/autorun.brs)');
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `perform6-${profile.slug}-`));
  try {
    fs.copyFileSync(autorun, path.join(staging, 'autorun.brs'));
    fs.copyFileSync(distIndex, path.join(staging, 'index.html'));
    fs.cpSync(distAssets, path.join(staging, 'assets'), { recursive: true });

    // Small manifest for humans / R2 catalog later
    fs.writeFileSync(
      path.join(staging, 'perform6-release.json'),
      JSON.stringify(
        {
          profile: profileKey,
          version,
          clusterMember: member || null,
          builtAt: new Date().toISOString(),
          files: ['autorun.brs', 'index.html', 'assets/'],
        },
        null,
        2,
      ),
    );

    zipDirectory(staging, outZip);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  console.log(`\n[release:zip] Created ${path.relative(root, outZip)}`);
  console.log('[release:zip] SD card root contents: autorun.brs, index.html, assets/');
  console.log(
    `[release:zip] Later R2 key suggestion: releases/${profile.slug}/${outName}`,
  );
}

main();
