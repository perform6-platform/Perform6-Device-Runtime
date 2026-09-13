import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceIdentityStore } from './device-identity.mjs';
import { wrapMediaKey, unwrapMediaKey } from './key-delivery.mjs';

function fixture(raw = null, failFlush = false) {
  let writes = 0;
  const registry = { async read() { return raw; }, async write(s, k, v) { raw = v; writes++; },
    async flush() { if (failFlush) throw new Error('sensitive'); } };
  return { registry, writes: () => writes };
}
test('create once, reuse across adapter recreation, unwrap offline', async () => {
  const f = fixture(), store = createDeviceIdentityStore(f.registry);
  const [a, b] = await Promise.all([store.loadOrCreate(), store.loadOrCreate()]);
  assert.equal(a.fingerprint, b.fingerprint); assert.equal(f.writes(), 1);
  const restored = await createDeviceIdentityStore(f.registry).loadOrCreate();
  assert.equal(restored.fingerprint, a.fingerprint); assert.equal(f.writes(), 1);
  const manifest = { schemaVersion: 1, algorithm: 'AesCtr', sizeBytes: 4,
    sha256: 'a'.repeat(64), ivHex: 'b'.repeat(32) };
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const wrapped = wrapMediaKey(a.publicPem, 'asset', manifest, key);
  assert.deepEqual(unwrapMediaKey(restored.privateKey, 'asset', manifest, wrapped), key);
});
test('corrupt or ambiguous existing identity is not replaced', async () => {
  for (const raw of ['', '{}', undefined, 'broken']) {
    const f = fixture(raw === undefined ? 'broken' : raw);
    await assert.rejects(createDeviceIdentityStore(f.registry).loadOrCreate());
    assert.equal(f.writes(), 0);
  }
});
test('failed flush prevents successful enrollment and no retry occurs', async () => {
  const f = fixture(null, true), store = createDeviceIdentityStore(f.registry);
  await assert.rejects(store.loadOrCreate(), /no automatic reset/);
  await assert.rejects(store.loadOrCreate(), /no automatic reset/);
  assert.equal(f.writes(), 1);
});
test('read error cannot trigger key generation', async () => {
  let writes = 0;
  const store = createDeviceIdentityStore({ read: async () => { throw new Error(); },
    write: async () => { writes++; } });
  await assert.rejects(store.loadOrCreate()); assert.equal(writes, 0);
});
