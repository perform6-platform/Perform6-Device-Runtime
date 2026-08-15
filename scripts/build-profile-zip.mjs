#!/usr/bin/env node
/**
 * Build a BrightSign SD-card package for one hardware profile.
 *
 * Usage:
 *   node scripts/build-profile-zip.mjs <XT2145|XC4055|HD226> [version] [CLUSTER_MEMBER]
 *
 * Examples:
 *   node scripts/build-profile-zip.mjs XT2145 1.0.0
 *   node scripts/build-profile-zip.mjs HD226 1.0.0 DEVICE_B
 *
 * Output (under releases/<profile-lower>/):
 *   perform6-<profile>[-member]-<version>/   ← ready folder (copy contents to SD root)
 *   perform6-<profile>[-member]-<version>.zip ← same contents (optional download / R2)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

function zipDirectory(packageFolder, zipPath) {
  // Zip the folder itself so Extract All creates perform6-…/ in Downloads.
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const parent = path.dirname(packageFolder);
  const base = path.basename(packageFolder);

  if (process.platform === 'win32') {
    const ps = [
      'Compress-Archive',
      '-Path',
      `"${packageFolder}"`,
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

  const result = spawnSync('zip', ['-r', zipPath, base], {
    cwd: parent,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail(`zip failed for ${zipPath} (is "zip" installed?)`);
}

/** Upload this profile's releases/* to R2 (uses backend .env credentials). */
function uploadProfileToR2(profileSlug) {
  if (process.env.SKIP_R2_UPLOAD === '1') {
    console.log('[release:zip] SKIP_R2_UPLOAD=1 — skipping R2 upload');
    return;
  }

  const apiRoot = path.resolve(root, '../../backend/perform6-api');
  const uploadScript = path.join(apiRoot, 'scripts', 'upload-startup-releases-r2.mjs');
  if (!fs.existsSync(uploadScript)) {
    console.warn(`[release:zip] R2 upload script missing (${uploadScript}) — skip`);
    return;
  }

  console.log(`[release:zip] Uploading releases/${profileSlug}/ → R2…`);
  const result = spawnSync(process.execPath, [uploadScript, profileSlug], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    fail('R2 upload failed — fix credentials in backend/perform6-api/.env or set SKIP_R2_UPLOAD=1');
  }
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
  const packageBase = `perform6-${profile.slug}${memberSuffix}-${version}`;
  const outDir = path.join(root, 'releases', profile.slug);
  const outFolder = path.join(outDir, packageBase);
  const outZip = path.join(outDir, `${packageBase}.zip`);

  console.log(`[release:zip] profile=${profileKey} version=${version}` +
    (member ? ` member=${member}` : ''));
  console.log(`[release:zip] mode=${profile.mode}`);
  console.log(`[release:zip] api from ${path.basename(envFile)} (edit VITE_API_BASE_URL for production)`);

  const buildEnv = {};
  if (member) {
    buildEnv.VITE_CLUSTER_MEMBER = member;
  }
  // Keep runtime version aligned with package version when provided.
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

  // Persist ready-to-copy folder (no extract step for SD deploy)
  if (fs.existsSync(outFolder)) {
    fs.rmSync(outFolder, { recursive: true, force: true });
  }
  fs.mkdirSync(outFolder, { recursive: true });

  fs.copyFileSync(autorun, path.join(outFolder, 'autorun.brs'));
  fs.copyFileSync(distIndex, path.join(outFolder, 'index.html'));
  fs.cpSync(distAssets, path.join(outFolder, 'assets'), { recursive: true });

  // Autorun reads this to apply the correct SetScreenModes layout.
  fs.writeFileSync(path.join(outFolder, 'perform6-profile.txt'), `${profileKey}\n`);

  const wiring =
    profileKey === 'XT2145'
      ? [
          'HDMI wiring (XT2145):',
          '  HDMI-1 → Bluefin touch panel (pairing + Home)',
          '  HDMI-2 → LED program display',
        ]
      : profileKey === 'XC4055'
        ? [
            'HDMI wiring (XC4055 — one player, three LEDs):',
            '  HDMI-1 → LED Screen 1 (SCREEN_1 / deployment)',
            '  HDMI-2 → LED Screen 2 (SCREEN_2 / deployment)',
            '  HDMI-3 → LED Screen 3 (SCREEN_3 / deployment)',
            '  HDMI-4 unused (disabled in autorun)',
          ]
        : [
            'HDMI wiring (HD226):',
            '  Single HDMI → one LED (one player per LED in the cluster)',
          ];

  fs.writeFileSync(
    path.join(outFolder, 'perform6-release.json'),
    JSON.stringify(
      {
        profile: profileKey,
        version,
        clusterMember: member || null,
        builtAt: new Date().toISOString(),
        multiHdmi:
          profileKey === 'XT2145'
            ? {
                outputs: 2,
                canvas: '2 independent 1920x1080 HtmlWidgets',
                outputMap: 'HDMI-1 x=0; HDMI-2 x=1920',
                mode: '1920x1080x60p:fullres',
              }
            : profileKey === 'XC4055'
              ? {
                  outputs: 3,
                  canvas: '3 independent 1920x1080 HtmlWidgets',
                  outputMap: 'HDMI-1 x=0; HDMI-2 x=1920; HDMI-3 x=3840',
                  mode: '1920x1080x60p:fullres',
                }
              : { outputs: 1, canvas: 'native', mode: 'default' },
        files: [
          'autorun.brs',
          'index.html',
          'assets/',
          'perform6-profile.txt',
          'README-SD.txt',
        ],
        entryScript: 'assets/app.js',
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(outFolder, 'README-SD.txt'),
    [
      `Perform6 BrightSign package — ${profileKey}${member ? ` / ${member}` : ''}`,
      `Version: ${version}`,
      '',
      'Supported firmwares: BrightSign OS 8.2+ and 9.x (Series 5: XT/XC/HD).',
      profileKey === 'HD226'
        ? 'HD226 uses native single-output mode (no SetScreenModes).'
        : 'Multi-HDMI is locked to 1920x1080x60p:fullres via SetScreenModes (no auto / no 120Hz fallback).',
      profileKey === 'XT2145'
        ? 'Two independent 1920x1080 HtmlWidgets: HDMI-1 touch runtime and HDMI-2 LED playback.'
        : profileKey === 'XC4055'
          ? 'Three independent 1920x1080 HtmlWidgets: HDMI-1 primary runtime and HDMI-2/3 LED playback.'
          : 'Canvas follows the player native resolution.',
      '',
      profileKey === 'XT2145'
        ? 'Bluefin owns pairing/sync/touch; HDMI-2 receives selected video through the local player relay.'
        : profileKey === 'XC4055'
          ? 'HDMI-1 owns pairing/sync and SCREEN_1; HDMI-2/3 receive SCREEN_2/3 through the local player relay.'
          : 'Each output shows a corner badge: HDMI label, live canvas size, version.',
      profileKey === 'XT2145' || profileKey === 'XC4055'
        ? 'No diagnostic panel or badge is drawn over multi-HDMI outputs.'
        : 'If a panel shows the BrightSign splash instead of a badge, report which HDMI is affected.',
      '',
      'IMPORTANT: Use this zip ONLY on matching hardware.',
      `  XT2145  -> perform6-xt2145-*.zip`,
      `  XC4055  -> perform6-xc4055-*.zip`,
      `  HD226   -> perform6-hd226-*.zip`,
      'Do NOT mix files from different zips.',
      '',
      ...wiring,
      '',
      'SD card root (copy CONTENTS of this folder, not the folder itself):',
      '  autorun.brs',
      '  perform6-profile.txt',
      '  index.html',
      '  assets/app.js',
      '  assets/style.css',
      '  assets/*.png',
      '',
      'After copy, reboot the player.',
      profileKey === 'HD226'
        ? 'No multi-HDMI reboot is expected on HD226.'
        : 'First boot may reboot again after enabling fullres multi-HDMI — that is expected.',
      'DWS (browser): http://<player-ip>/',
      '',
    ].join('\n'),
  );

  // Optional single-file package for cloud / R2 / email
  zipDirectory(outFolder, outZip);

  uploadProfileToR2(profile.slug);

  console.log(`\n[release:zip] Folder: ${path.relative(root, outFolder)}`);
  console.log(`[release:zip] ZIP:    ${path.relative(root, outZip)}`);
  console.log('[release:zip] SD card: copy folder CONTENTS to card root (not the folder itself)');
  console.log('[release:zip] Required on SD root: autorun.brs, index.html, assets/');
  console.log(
    `[release:zip] R2 keys: releases/${profile.slug}/${packageBase}/… and .zip`,
  );
}

main();
