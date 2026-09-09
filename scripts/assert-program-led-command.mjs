/**
 * Prove program buttons must target a different LED command than idle/DEFAULT.
 * Physical XT not required — static + pure command shaping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`[assert:program-led] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[assert:program-led] OK: ${msg}`);
}

/** Mirror src/services/playbackSrc.ts toLedPlayableSrc (pool / .mp4 only). */
function toLedPlayableSrc(src) {
  if (!src || src.startsWith('blob:')) return '';
  const lower = src.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return '';
  let sd = String(src).trim();
  if (sd.startsWith('file:///SD:/') || sd.startsWith('file:///sd:/')) {
    sd = `SD:/${sd.slice('file:///SD:/'.length)}`;
  } else if (sd.startsWith('/storage/sd/')) {
    sd = `SD:/${sd.slice('/storage/sd/'.length)}`;
  } else if (/^sd:/i.test(sd)) {
    sd = `SD:/${sd.replace(/^sd:\/*/i, '')}`;
  }
  const pathLower = sd.toLowerCase().split('?')[0] ?? '';
  if (!pathLower.startsWith('sd:/')) return '';
  if (pathLower.includes('perform6-media-pool')) {
    return pathLower.length > 'sd:/perform6-media-pool/'.length ? sd : '';
  }
  if (
    pathLower.endsWith('.mp4') ||
    pathLower.endsWith('.mov') ||
    pathLower.endsWith('.m4v') ||
    pathLower.endsWith('.webm')
  ) {
    return sd;
  }
  return '';
}

function buildLedCommand({ slot, mediaVersionId, title, src }) {
  const playSrc = toLedPlayableSrc(src);
  if (!playSrc) fail(`slot ${slot} has no local playable src`);
  return {
    type: 'led-playback',
    target: 'led',
    slot,
    mediaVersionId,
    mediaTitle: title,
    src: playSrc,
    restartNonce: String(Date.now()),
  };
}

function assertSourceGuards() {
  const home = fs.readFileSync(path.join(root, 'src', 'pages', 'Home.tsx'), 'utf8');
  if (!home.includes('sessionOpen || overviewOpen')) {
    fail('Home.tsx must not push idle LED while overview modal is open');
  }
  if (!home.includes("beginSession('start-here'")) {
    fail('Home.tsx must beginSession start-here with startHere video');
  }

  const store = fs.readFileSync(path.join(root, 'src', 'stores', 'runtimeStore.ts'), 'utf8');
  if (!store.includes('mediaChanged') || !store.includes('displayRestartNonce')) {
    fail('runtimeStore must bump restartNonce when media/src changes');
  }
  const resetImpl = store.slice(store.indexOf('resetDisplayControls: () =>'));
  const resetEnd = resetImpl.indexOf('toggleDisplayPaused');
  const resetBody = resetEnd > 0 ? resetImpl.slice(0, resetEnd) : resetImpl.slice(0, 400);
  if (resetBody.includes('displayRestartNonce')) {
    fail('resetDisplayControls must not zero displayRestartNonce');
  }

  const alias = fs.readFileSync(path.join(root, 'src', 'services', 'mp4AliasQueue.ts'), 'utf8');
  if (/\bcopyFileSync\b/.test(alias) || /\blinkSync\b/.test(alias)) {
    fail('mp4AliasQueue must not hardlink/copyFileSync (pool-direct only)');
  }
  if (!alias.includes('intentionally empty')) {
    fail('mp4AliasQueue enqueue must be a documented no-op');
  }

  const zipScript = fs.readFileSync(path.join(root, 'scripts', 'build-profile-zip.mjs'), 'utf8');
  if (zipScript.includes('Eager alias:') || zipScript.includes('CopyFile only on fail')) {
    fail('build-profile-zip README-SD text still describes removed alias/CopyFile');
  }
  if (!zipScript.includes('pool-direct PlayFile + ProbeString')) {
    fail('build-profile-zip README-SD must document pool-direct');
  }

  ok('source guards (Home idle race, nonce, no JS alias copy, README)');
}

function assertProgramReplacesDefault() {
  const golfDefaultId = 'mv-golf-default-001';
  const startHereId = 'mv-golf-start-here-002';
  const gymDefaultId = 'mv-fitness-default-001';
  const gymStartId = 'mv-fitness-start-here-002';

  const pool = (leaf) =>
    `SD:/perform6-media-pool/ab/sha256-${leaf}`;

  const idleGolf = buildLedCommand({
    slot: 'touch-default',
    mediaVersionId: golfDefaultId,
    title: 'Golf Default',
    src: pool('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  });
  const startGolf = buildLedCommand({
    slot: 'start-here',
    mediaVersionId: startHereId,
    title: 'Start Here',
    src: pool('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  });

  if (idleGolf.mediaVersionId === startGolf.mediaVersionId) {
    fail('Start Here must not reuse Golf-Default mediaVersionId');
  }
  if (idleGolf.src === startGolf.src) {
    fail('Start Here must write a different LED src than DEFAULT');
  }

  const idleGym = buildLedCommand({
    slot: 'touch-default',
    mediaVersionId: gymDefaultId,
    title: 'Fitness Default',
    src: pool('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
  });
  const startGym = buildLedCommand({
    slot: 'start-here',
    mediaVersionId: gymStartId,
    title: 'Start Here',
    src: pool('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
  });

  if (idleGym.mediaVersionId === startGym.mediaVersionId) {
    fail('Gym Start Here must not reuse Fitness-Default mediaVersionId');
  }
  if (idleGolf.mediaVersionId === idleGym.mediaVersionId) {
    fail('Golf vs Gym defaults must be different mediaVersionIds (deployment-driven)');
  }

  // HTTPS must never become an LED command (no on-demand).
  if (toLedPlayableSrc('https://cdn.example/golf.mp4')) {
    fail('HTTPS must not be LED-playable');
  }

  ok('program LED command replaces DEFAULT (Golf + Gym ids/paths)');
  console.log(
    JSON.stringify(
      {
        before: { mediaVersionId: idleGolf.mediaVersionId, src: idleGolf.src },
        afterStartHere: {
          mediaVersionId: startGolf.mediaVersionId,
          src: startGolf.src,
        },
      },
      null,
      2,
    ),
  );
}

assertSourceGuards();
assertProgramReplacesDefault();
console.log('[assert:program-led] all checks passed');
