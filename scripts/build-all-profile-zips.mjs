#!/usr/bin/env node
/**
 * Build BrightSign ZIPs for XT2145, XC4055, and HD226 (DEVICE_A default).
 * Usage: node scripts/build-all-profile-zips.mjs [version]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] || process.env.npm_package_version || '0.1.0';
const script = path.join(root, 'scripts', 'build-profile-zip.mjs');

for (const profile of ['XT2145', 'XC4055', 'HD226']) {
  const result = spawnSync(process.execPath, [script, profile, version], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\n[release:zip:all] Done — see releases/ for v${version}`);
