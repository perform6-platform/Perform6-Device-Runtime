#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, SKIP_R2_UPLOAD: '1' },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'typecheck']);
run(process.execPath, [
  '--test',
  'scripts/encryption-lab/offline-persistence.test.mjs',
  'scripts/encryption-lab/production-media-encryption.test.mjs',
  'scripts/encryption-lab/card-recovery.test.mjs',
  'scripts/sync-completion-regression.test.mjs',
]);
run(process.execPath, [
  '--experimental-strip-types',
  '--test',
  'scripts/encryption-lab/offline-rollover.test.mjs',
]);
run('npm', ['run', 'release:zip:xt2145:fitness']);
run('npm', ['run', 'release:zip:xt2145:golf']);
run('npm', ['run', 'release:zip:hd226']);

console.log('[production-runtime] PASS: static, offline, encryption, and package gates');
console.log('[production-runtime] Physical-player validation remains required; see docs/REAL-PLAYER-VALIDATION.md');
