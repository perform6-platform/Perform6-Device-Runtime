import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPosixZipPaths, crc32, writePosixZip } from './posix-zip.mjs';

test('crc32 matches the known ISO vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('release ZIP stores nested files with forward slashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-zip-'));
  const folder = path.join(root, 'perform6-sample-1.0.0');
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'autorun.brs'), 'print "ok"\n');
  fs.writeFileSync(path.join(folder, 'assets', 'app.js'), 'console.log(1)\n');
  const zipPath = path.join(root, 'perform6-sample-1.0.0.zip');
  writePosixZip(folder, zipPath);
  const names = assertPosixZipPaths(zipPath);
  assert.deepEqual(names.sort(), [
    'perform6-sample-1.0.0/assets/app.js',
    'perform6-sample-1.0.0/autorun.brs',
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});
