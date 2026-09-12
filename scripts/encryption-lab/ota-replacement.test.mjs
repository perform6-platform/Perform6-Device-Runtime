// Characterize the current production-source replacement primitive offline.
// Passing tests document a hazard, NOT a safe updater or hardware validation.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../../src/services/otaAssetPool.ts', import.meta.url), 'utf8');
const body = source.match(/function replaceFile\([\s\S]*?\): void \{([\s\S]*?)\n\}/)?.[1];
assert.ok(body, 'Replacement primitive changed: review this characterization');
const replace = new Function('fs', 'destination', 'data', 'ensureParentDir', body);

function fixture(failAt) {
  const files = new Map([['/active', 'old']]);
  const fs = {
    existsSync: p => files.has(p),
    writeFileSync(p, data) {
      if (failAt === 'write') throw new Error('injected write failure');
      files.set(p, data);
    },
    unlinkSync(p) { files.delete(p); },
    renameSync(from, to) {
      if (failAt === 'rename') throw new Error('injected rename failure');
      files.set(to, files.get(from)); files.delete(from);
    },
  };
  return { files, run: () => replace(fs, '/active', 'new', () => {}) };
}

test('successful replacement installs new bytes in mocked filesystem', () => {
  const f = fixture(); f.run(); assert.equal(f.files.get('/active'), 'new');
});
test('temporary-write failure retains active file', () => {
  const f = fixture('write'); assert.throws(f.run);
  assert.equal(f.files.get('/active'), 'old');
});
test('KNOWN HAZARD: rename failure after unlink leaves active path absent', () => {
  const f = fixture('rename'); assert.throws(f.run);
  assert.equal(f.files.has('/active'), false);
  assert.equal(f.files.get('/active.perform6-new'), 'new');
});
