import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackReference } from './playback-reference.mjs';
const input = () => ({ assetId: 'video-1', requestId: 'trial-1', sha256: 'a'.repeat(64) });
test('reference is a strict immutable projection', () => {
  const result = playbackReference(input());
  assert.deepEqual(Object.keys(result), ['type', 'assetId', 'requestId', 'sha256']);
  assert.ok(Object.isFrozen(result));
});
test('rejects keys, paths and unknown fields instead of serializing them', () => {
  for (const field of ['key', 'EncryptionKey', 'privatePem', 'iv', 'src', 'filename', 'config']) {
    assert.throws(() => playbackReference({ ...input(), [field]: 'not-allowed' }));
  }
});
test('rejects empty containers, traversal and missing fields', () => {
  for (const value of [null, [], {}, { ...input(), assetId: '../video' }, { ...input(), sha256: '' }]) {
    assert.throws(() => playbackReference(value));
  }
});
