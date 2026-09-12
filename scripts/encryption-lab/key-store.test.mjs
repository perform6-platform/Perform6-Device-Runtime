import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaKeyStore } from './key-store.mjs';
const record = { version: 1, algorithm: 'AesCtr',
  keyHex: '00112233445566778899aabbccddeeff', ivHex: '0'.repeat(32) };
function fixture(failure) {
  let saved;
  const calls = [];
  const registry = {
    async write(s, k, v) { calls.push('write'); assert.equal(s, 'perform6_media_keys');
      if (failure === 'write') throw new Error('sensitive'); saved = v; },
    async flush() { calls.push('flush'); if (failure === 'flush') throw new Error('sensitive'); },
    async read(s, k) { calls.push('read'); return failure === 'read' ? '{}' : saved; },
  };
  return { calls, registry, store: createMediaKeyStore(registry) };
}
test('persists one record, flushes, reads back, supports a new adapter instance', async () => {
  const f = fixture(); await f.store.save('test_asset', record);
  assert.deepEqual(f.calls, ['write', 'flush', 'read']);
  assert.deepEqual(await createMediaKeyStore(f.registry).read('test_asset'), record);
});
for (const failure of ['write', 'flush', 'read']) {
  test(`${failure} failure does not report persistence success or expose data`, async () => {
    const f = fixture(failure);
    await assert.rejects(f.store.save('test_asset', record), { message: 'Key persistence unverified' });
  });
}
test('missing key blocks playback', async () => {
  await assert.rejects(fixture().store.read('test_asset'), { message: 'Playback key unavailable' });
});
test('rejects invalid keys and identifiers before any registry writes', async () => {
  const f = fixture();
  await assert.rejects(f.store.save('../escape', record));
  await assert.rejects(f.store.save('test_asset', { ...record, keyHex: 'a'.repeat(32) }));
  assert.deepEqual(f.calls, []);
});
