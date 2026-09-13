import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signDelivery, verifyDelivery } from './signed-delivery.mjs';

const server = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = server.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = server.publicKey.export({ type: 'spki', format: 'pem' });
const fixture = () => ({ assetId: 'video-1', recipientFingerprint: 'a'.repeat(64),
  manifest: { schemaVersion: 1, algorithm: 'AesCtr', sizeBytes: 512,
    sha256: 'b'.repeat(64), ivHex: 'c'.repeat(32) }, wrappedKey: Buffer.alloc(256, 3).toString('base64') });

test('signed delivery produces an immutable verified snapshot', () => {
  const d = fixture();
  const result = verifyDelivery(publicPem, d, signDelivery(privatePem, d), d.recipientFingerprint);
  assert.deepEqual(result, d);
  d.manifest.ivHex = 'd'.repeat(32);
  assert.equal(result.manifest.ivHex, 'c'.repeat(32));
  assert.ok(Object.isFrozen(result.manifest));
});
test('rejects substitution of every authenticated field', () => {
  for (const change of [d => d.assetId = 'other', d => d.recipientFingerprint = 'd'.repeat(64),
    d => d.manifest.sizeBytes++, d => d.manifest.sha256 = 'e'.repeat(64),
    d => d.manifest.ivHex = 'f'.repeat(32), d => d.wrappedKey = Buffer.alloc(256, 4).toString('base64')]) {
    const d = fixture(); const signature = signDelivery(privatePem, d); change(d);
    assert.throws(() => verifyDelivery(publicPem, d, signature, 'a'.repeat(64)), /verification failed/);
  }
});
test('rejects wrong pinned signing key and wrong local recipient', () => {
  const d = fixture(); const signature = signDelivery(privatePem, d);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => verifyDelivery(other, d, signature, d.recipientFingerprint));
  assert.throws(() => verifyDelivery(publicPem, d, signature, 'f'.repeat(64)));
});
test('rejects malformed signature and invalid manifest', () => {
  const d = fixture();
  assert.throws(() => verifyDelivery(publicPem, d, '!', d.recipientFingerprint));
  d.manifest.sizeBytes = -1;
  assert.throws(() => signDelivery(privatePem, d));
});
