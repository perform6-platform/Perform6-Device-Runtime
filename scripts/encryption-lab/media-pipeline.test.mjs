import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createDecipheriv, createHash } from 'node:crypto';
import { encryptMedia, playbackKeyBytes } from './media-pipeline.mjs';

async function fixture(chunks) {
  const output = [];
  const sink = new Writable({ write(chunk, encoding, done) { output.push(Buffer.from(chunk)); done(); } });
  const result = await encryptMedia(Readable.from(chunks), sink);
  return { ...result, ciphertext: Buffer.concat(output) };
}
test('streams irregular chunks, returns ciphertext metadata and separate secret', async () => {
  const chunks = [Buffer.from('abc'), Buffer.alloc(65539, 7), Buffer.from('end')];
  const original = Buffer.concat(chunks), result = await fixture(chunks);
  assert.equal(result.manifest.sizeBytes, original.length);
  assert.equal(result.manifest.sha256, createHash('sha256').update(result.ciphertext).digest('hex'));
  const decipher = createDecipheriv('aes-128-ctr', result.keyMaterial, Buffer.from(result.manifest.ivHex, 'hex'));
  assert.deepEqual(Buffer.concat([decipher.update(result.ciphertext), decipher.final()]), original);
  assert.equal(JSON.stringify(result.manifest).includes(result.keyMaterial.toString('hex')), false);
  const bytes = playbackKeyBytes(result.keyMaterial, result.manifest.ivHex);
  assert.equal(bytes.length, 32);
  assert.deepEqual(bytes.subarray(0, 16), result.keyMaterial);
});
test('each encryption receives new key and IV', async () => {
  const a = await fixture([Buffer.from('same')]), b = await fixture([Buffer.from('same')]);
  assert.notDeepEqual(a.keyMaterial, b.keyMaterial);
  assert.notEqual(a.manifest.ivHex, b.manifest.ivHex);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});
test('empty input returns no successful manifest', async () => {
  await assert.rejects(fixture([]), /discard partial destination/);
});
test('destination failure is sanitized and returns no manifest', async () => {
  const sink = new Writable({ write(c, e, done) { done(new Error('SECRET downstream path')); } });
  await assert.rejects(encryptMedia(Readable.from([Buffer.from('video')]), sink),
    { message: 'Media encryption failed; discard partial destination' });
});
test('rejects unsupported sizes, repeated key halves and malformed IV', () => {
  for (const key of [Buffer.alloc(32), Buffer.alloc(16), 'not-a-buffer']) {
    assert.throws(() => playbackKeyBytes(key, 'a'.repeat(32)));
  }
  assert.throws(() => playbackKeyBytes(Buffer.from('00112233445566778899aabbccddeeff', 'hex'), 'invalid'));
});
