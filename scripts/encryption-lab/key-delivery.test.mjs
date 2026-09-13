import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createDecipheriv } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { encryptMedia } from './media-pipeline.mjs';
import { wrapMediaKey, unwrapMediaKey, verifyCiphertext } from './key-delivery.mjs';

const owner = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const chunks = [];
const original = Buffer.from('Disposable media stand-in; no proprietary content');
const prepared = await encryptMedia(Readable.from([original]),
  new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }));
const ciphertext = Buffer.concat(chunks);
const wrapped = wrapMediaKey(owner.publicKey, 'asset_test', prepared.manifest, prepared.keyMaterial);

test('end to end: encrypted media + wrapped key decrypt with enrolled private key', () => {
  const key = unwrapMediaKey(owner.privateKey, 'asset_test', prepared.manifest, wrapped);
  const d = createDecipheriv('aes-128-ctr', key, Buffer.from(prepared.manifest.ivHex, 'hex'));
  assert.deepEqual(Buffer.concat([d.update(ciphertext), d.final()]), original);
  key.fill(0);
});
test('copyable metadata contains neither media key nor private key', () => {
  const copyable = JSON.stringify({ manifest: prepared.manifest, wrapped });
  assert.equal(copyable.includes(prepared.keyMaterial.toString('hex')), false);
  assert.equal(copyable.includes('PRIVATE KEY'), false);
});
test('another device private key cannot unwrap copied envelope', () => {
  assert.throws(() => unwrapMediaKey(stranger.privateKey, 'asset_test', prepared.manifest, wrapped),
    /Media key verification failed/);
});
test('asset identity substitution is rejected', () => {
  assert.throws(() => unwrapMediaKey(owner.privateKey, 'different_asset', prepared.manifest, wrapped));
});
test('metadata substitution is rejected', () => {
  for (const change of [{ ivHex: 'f'.repeat(32) }, { sha256: 'f'.repeat(64) },
    { sizeBytes: prepared.manifest.sizeBytes + 1 }]) {
    assert.throws(() => unwrapMediaKey(owner.privateKey, 'asset_test', { ...prepared.manifest, ...change }, wrapped));
  }
});
test('damaged envelope is rejected', () => {
  const bytes = Buffer.from(wrapped, 'base64'); bytes[0] ^= 1;
  assert.throws(() => unwrapMediaKey(owner.privateKey, 'asset_test', prepared.manifest, bytes.toString('base64')));
});
test('ciphertext verification accepts exact bytes', async () => {
  await verifyCiphertext(Readable.from([ciphertext]), prepared.manifest);
});
test('ciphertext verification rejects tampering, truncation and extra bytes', async () => {
  const damaged = Buffer.from(ciphertext); damaged[0] ^= 1;
  for (const bytes of [damaged, ciphertext.subarray(1), Buffer.concat([ciphertext, Buffer.from('x')])]) {
    await assert.rejects(verifyCiphertext(Readable.from([bytes]), prepared.manifest),
      /Ciphertext verification failed/);
  }
});
