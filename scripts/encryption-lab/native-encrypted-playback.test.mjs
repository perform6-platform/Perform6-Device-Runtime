import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./native-encrypted-playback.brs', import.meta.url), 'utf8');

test('encrypted playback is isolated from boot and plaintext playback', () => {
  assert.doesNotMatch(source, /^Sub Main\b/im);
  assert.match(source, /SD:\/perform6-encrypted-media\/[^\n]+\.p6enc/);
  assert.match(source, /requestedPath <> expectedPath/);
  assert.match(source, /P6LabReadPlaybackKey\(assetId\)/);
  assert.match(source, /EncryptionAlgorithm = "AesCtr"/);
  assert.match(source, /EncryptionKey = material/);
  assert.doesNotMatch(source, /fallback/i);
  assert.doesNotMatch(source, /keyHex|ivHex|ToHexString|WriteAsciiFile/i);
});

test('every precondition returns before native playback', () => {
  const playAt = source.indexOf('played = vp.PlayFile(params)');
  assert.ok(playAt > 0);
  for (const guard of [
    'type(vp) <> "roVideoPlayer"',
    'requestedPath <> expectedPath',
    'material.Count() <> 32',
  ]) {
    const guardAt = source.indexOf(guard);
    assert.ok(guardAt > 0 && guardAt < playAt, `${guard} must precede PlayFile`);
  }
});
