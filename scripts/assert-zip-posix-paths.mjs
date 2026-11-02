#!/usr/bin/env node
import { assertPosixZipPaths } from './posix-zip.mjs';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('[zip-posix] FAIL: usage: node scripts/assert-zip-posix-paths.mjs <package.zip>');
  process.exit(1);
}

try {
  const names = assertPosixZipPaths(zipPath);
  console.log(`[zip-posix] PASS: ${names.length} entries use / separators`);
} catch (error) {
  console.error(`[zip-posix] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
