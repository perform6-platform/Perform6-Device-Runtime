import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { encryptMedia } from './media-pipeline.mjs';
import { wrapMediaKey } from './key-delivery.mjs';
import { signDelivery } from './signed-delivery.mjs';
import { validateCandidate } from './validate-candidate.mjs';
const device = generateKeyPairSync('rsa', { modulusLength: 2048 });
const server = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fingerprint = createHash('sha256').update(device.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const publicPem = server.publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = server.privateKey.export({ type: 'pkcs8', format: 'pem' });
const chunks = [];
const media = await encryptMedia(Readable.from([Buffer.from('synthetic video stand-in')]),
  new Writable({ write(chunk, _, cb) { chunks.push(Buffer.from(chunk)); cb(); } }));
const ciphertext = Buffer.concat(chunks);
const delivery = { assetId: 'candidate-1', recipientFingerprint: fingerprint,
  manifest: media.manifest, wrappedKey: wrapMediaKey(device.publicKey, 'candidate-1', media.manifest, media.keyMaterial) };
const signature = signDelivery(privatePem, delivery);
const options = () => ({ publicPem, privateKey: device.privateKey, fingerprint,
  delivery, signature, source: Readable.from([ciphertext]) });

test('composed encrypted candidate verification succeeds without returning secrets', async () => {
  const events = [];
  const result = await validateCandidate({ ...options(), report: e => events.push(e) });
  assert.deepEqual(result, { verified: true, assetId: 'candidate-1' });
  assert.equal(events[0].event, 'ENCRYPTED_CANDIDATE_VERIFIED_OFFLINE');
  assert.equal(JSON.stringify({ result, events }).includes(media.keyMaterial.toString('hex')), false);
});
test('bad signature rejects before reading ciphertext', async () => {
  let read = false;
  const source = { async *[Symbol.asyncIterator]() { read = true; yield ciphertext; } };
  assert.deepEqual(await validateCandidate({ ...options(), signature: 'bad', source }), { verified: false, stage: 'signature' });
  assert.equal(read, false);
});
test('tampered media and read errors reject without activation', async () => {
  const bad = Buffer.from(ciphertext); bad[0] ^= 1;
  for (const source of [Readable.from([bad]), { async *[Symbol.asyncIterator]() { throw new Error('secret'); } }]) {
    assert.deepEqual(await validateCandidate({ ...options(), source }), { verified: false, stage: 'ciphertext' });
  }
});
test('wrong device private key fails even with valid signed metadata', async () => {
  assert.deepEqual(await validateCandidate({ ...options(), privateKey: server.privateKey }), { verified: false, stage: 'key' });
});
test('reporter exception does not alter verification', async () => {
  assert.equal((await validateCandidate({ ...options(), report: () => { throw new Error(); } })).verified, true);
});
test('late media read after timeout cannot report verification success', async () => {
  let release;
  const events = [];
  const source = { async *[Symbol.asyncIterator]() {
    await new Promise(resolve => { release = resolve; }); yield ciphertext;
  } };
  const result = await validateCandidate({ ...options(), source, timeoutMs: 10, report: e => events.push(e) });
  assert.deepEqual(result, { verified: false, stage: 'timeout' });
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.map(e => e.event), ['ENCRYPTED_CANDIDATE_TIMEOUT']);
});
