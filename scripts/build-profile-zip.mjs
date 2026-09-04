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
    // BrightAuthor-style: React on HDMI-1 + native roVideoPlayer on HDMI-2.
    displayMode: 'MULTI',
  },
  XC4055: {
    mode: 'brightsign-xc4055',
    slug: 'xc4055',
    displayMode: 'MULTI',
  },
  HD226: {
    mode: 'brightsign-hd226',
    slug: 'hd226',
    displayMode: 'MULTI',
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

  const apiRootCandidates = [
    path.resolve(root, '../perform6-api'),
    path.resolve(root, '../../backend/perform6-api'),
  ];
  const apiRoot = apiRootCandidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'scripts', 'upload-startup-releases-r2.mjs')),
  );
  if (!apiRoot) {
    console.warn(
      `[release:zip] R2 upload script missing (tried ${apiRootCandidates.join(', ')}) — skip`,
    );
    return;
  }
  const uploadScript = path.join(apiRoot, 'scripts', 'upload-startup-releases-r2.mjs');

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

  // XT/XC: Perform6 logo on LED until the first deployment video arrives.
  const ledIdlePng = path.join(root, 'brightsign', 'led-idle.png');
  if (
    (profileKey === 'XT2145' || profileKey === 'XC4055') &&
    fs.existsSync(ledIdlePng)
  ) {
    fs.copyFileSync(ledIdlePng, path.join(outFolder, 'led-idle.png'));
  }

  // Autorun reads this to apply the correct SetScreenModes layout.
  fs.writeFileSync(path.join(outFolder, 'perform6-profile.txt'), `${profileKey}\n`);

  // Field-editable output switch — no rebuild needed to change HDMI layout.
  const displayMode = profile.displayMode;
  fs.writeFileSync(path.join(outFolder, 'perform6-display.txt'), `${displayMode}\n`);

  const defaultOpsPath = path.join(root, 'brightsign', 'perform6-ops.json');
  if (fs.existsSync(defaultOpsPath)) {
    fs.copyFileSync(defaultOpsPath, path.join(outFolder, 'perform6-ops.json'));
  }

  const emergencyOpsPath = path.join(root, 'brightsign', 'perform6-ops.emergency.json');
  if (fs.existsSync(emergencyOpsPath)) {
    fs.copyFileSync(emergencyOpsPath, path.join(outFolder, 'perform6-ops.emergency.json'));
  }

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
        displayMode,
        storageEncryption: {
          enabled: false,
          note: 'Plaintext SD — HtmlWidget requires readable index.html. Media lives in SD:/perform6-cache only (single-cache model).',
        },
        mediaCache: {
          path: 'SD:/perform6-cache',
          naming: 'SimpleHash(fileUrl)+ext',
          usedBy: ['HtmlWidget file:// playback', 'native roVideoPlayer LEDs'],
        },
        displayModeFile: 'perform6-display.txt',
        displayModeOptions: ['MULTI', 'MULTI_NOFULLRES'],
        multiHdmi:
          profileKey === 'XT2145'
            ? {
                outputs: 2,
                canvas: 'HDMI-1 HtmlWidget + HDMI-2 native roVideoPlayer',
                outputMap: 'HDMI-1 x=0; HDMI-2 x=1920',
                mode: displayMode === 'MULTI_NOFULLRES' ? '1920x1080x60p' : '1920x1080x60p:fullres',
                ledPlayback: 'roRtspStream for http(s) + SD:/perform6-cache offline copy',
                ledIdleClip: 'led-idle.png (packaged) or led-idle.mp4 override',
                audioRoute: 'HDMI-1 touch silent; native video audio to HDMI-2',
                ledLog: 'SD:/perform6-led.log',
              }
            : profileKey === 'XC4055'
              ? {
                  outputs: 3,
                  canvas: 'HDMI-1 HtmlWidget + HDMI-2/3 native roVideoPlayer',
                  outputMap: 'HDMI-1 x=0; HDMI-2 x=1920; HDMI-3 x=3840',
                  mode: displayMode === 'MULTI_NOFULLRES' ? '1920x1080x60p' : '1920x1080x60p:fullres',
                  ledPlayback: 'roRtspStream for http(s) + SD:/perform6-cache offline copy',
                  ledIdleClip: 'led-idle.png (packaged) or led-idle.mp4 override',
                  audioRoute: 'SCREEN_1 to HDMI-1; SCREEN_2 to HDMI-2; SCREEN_3 to HDMI-3',
                  ledLog: 'SD:/perform6-led.log',
                }
              : { outputs: 1, canvas: 'native', mode: 'default' },
        files: [
          'autorun.brs',
          'index.html',
          'assets/',
          'perform6-profile.txt',
          'perform6-display.txt',
          'perform6-ops.json',
          'perform6-ops.emergency.json',
          ...(profileKey === 'XT2145' || profileKey === 'XC4055' ? ['led-idle.png'] : []),
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
      'Storage: plaintext SD (no EncryptStorage). App files stay readable for HtmlWidget.',
      'Media cache: SD:/perform6-cache/ — single source for Bluefin/HD HTML and XT/XC LEDs.',
      '  Videos download once into perform6-cache (not IndexedDB). Rotation prune removes unused files.',
      '',
      `Display mode (perform6-display.txt): ${displayMode}`,
      '  MULTI           = BrightAuthor-style: HDMI-1 React + secondary native roVideoPlayer(s)',
      '  MULTI_NOFULLRES = same layout without :fullres (scaled graphics)',
      'XT/XC always run MULTI (SINGLE is not used). Edit only if you need MULTI_NOFULLRES.',
      '',
      profileKey === 'XT2145'
        ? 'Layout: HDMI-1 = React pairing/touch (Bluefin); HDMI-2 = native video (LED).'
        : profileKey === 'XC4055'
          ? 'Layout: HDMI-1 = React primary; HDMI-2/3 = native video for SCREEN_2/SCREEN_3.'
          : 'Canvas follows the player native resolution.',
      profileKey === 'XT2145'
        ? 'Bluefin + LED both play from SD:/perform6-cache (file:// / PlayFile); HTTPS only as online fallback.'
        : profileKey === 'XC4055'
          ? 'All outputs play from SD:/perform6-cache after sync; HTTPS fallback while online.'
          : 'Each HD226 player caches assigned media to SD:/perform6-cache and plays file://.',
      profileKey === 'XT2145'
        ? 'Audio: Bluefin HDMI-1 is silent; programme audio is routed only to LED HDMI-2.'
        : profileKey === 'XC4055'
          ? 'Audio: each programme player is routed to its matching HDMI-1/2/3 display.'
          : 'Audio: HTML media is explicitly routed to the single HDMI LED.',
      profileKey === 'XT2145' || profileKey === 'XC4055'
        ? 'Secondary outputs are video-only — no React UI, no pairing screen on the LED.'
        : 'If a panel shows the BrightSign splash instead of a badge, report which HDMI is affected.',
      '',
      ...(profileKey === 'XT2145' || profileKey === 'XC4055'
        ? [
            'LED video playback:',
            '  Prefer SD:/perform6-cache local files; otherwise stream via roRtspStream and cache.',
            '  Default idle: led-idle.png (Perform6 logo) is packaged on the SD root and loops',
            '  on the LED(s) from boot until the first deployment video arrives.',
            '  Optional override: place led-idle.mp4 on the SD root to replace the logo.',
            '  Troubleshooting: SD:/perform6-led.log lists every LED playback decision.',
            '',
          ]
        : []),
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
      '  perform6-display.txt',
      '  perform6-ops.json (field ops — pause sync/OTA, clear cache on boot)',
      '  index.html',
      '  assets/app.js',
      '  assets/style.css',
      '  assets/*.png',
      ...(profileKey === 'XT2145' || profileKey === 'XC4055'
        ? ['  led-idle.png (Perform6 logo — shows on LED until deployment video)']
        : []),
      '',
      'After copy, reboot the player.',
      'First boot reboots once while the output layout is applied — that is expected.',
      'Changing perform6-display.txt also causes one extra reboot on the next start.',
      '',
      'Field maintenance (perform6-ops.json on SD root):',
      '  pauseMediaSync     = true  → stop media downloads (sync-check skipped)',
      '  pauseOta           = true  → refuse OTA unless Admin Install (allowWhenPaused); default',
      '                              Auto-OTA on sync is code-disabled — portal Install OTA only.',
      '  clearCacheOnBoot   = true  → wipe SD:/perform6-cache once on next boot (auto-clears)',
      '  rebootAfterCacheClear = true → reboot after clearCacheOnBoot',
      '  syncOnBoot         = true  → run one sync after boot (auto-clears; bypasses pause)',
      '  Emergency template: copy perform6-ops.emergency.json → perform6-ops.json',
      '  See docs/CLIENT-SD-MAINTENANCE.md for full site procedure.',
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
