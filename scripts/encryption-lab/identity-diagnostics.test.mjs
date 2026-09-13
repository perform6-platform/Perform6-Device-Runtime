import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceIdentityStore } from './device-identity.mjs';

test('events distinguish persistence stages and existing identity load, no private bytes', async () => {
  let raw = null;
  const events = [];
  const registry = { read: async () => raw, write: async (s, k, v) => { raw = v; }, flush: async () => {} };
  const identity = await createDeviceIdentityStore(registry, e => events.push(e)).loadOrCreate();
  await createDeviceIdentityStore(registry, e => events.push(e)).loadOrCreate();
  assert.deepEqual(events.map(e => e.event), ['KEY_REGISTRY_WRITE_OK', 'KEY_REGISTRY_FLUSH_OK',
    'KEY_REGISTRY_READBACK_OK', 'KEY_IDENTITY_LOADED']);
  assert.equal(events[2].fingerprint, identity.fingerprint);
  assert.equal(events[3].fingerprint, identity.fingerprint);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('PRIVATE KEY'), false);
  assert.equal(serialized.includes(JSON.parse(raw).privatePem.split('\n')[1]), false);
  assert.ok(events.every(e => Object.keys(e).every(k => ['event', 'fingerprint'].includes(k))));
});
test('failure records fixed stage only, never raw exception', async () => {
  const events = [];
  await assert.rejects(createDeviceIdentityStore({ read: async () => { throw new Error('SECRET key data'); } },
    e => events.push(e)).loadOrCreate());
  assert.deepEqual(events, [{ event: 'KEY_IDENTITY_FAILED', stage: 'read' }]);
});
test('flush failure never emits readback success', async () => {
  const events = [];
  const registry = { read: async () => null, write: async () => {}, flush: async () => { throw new Error(); } };
  await assert.rejects(createDeviceIdentityStore(registry, e => events.push(e)).loadOrCreate());
  assert.deepEqual(events, [{ event: 'KEY_REGISTRY_WRITE_OK' }, { event: 'KEY_IDENTITY_FAILED', stage: 'flush' }]);
});
test('broken diagnostic transport does not break successful storage', async () => {
  let raw = null;
  const registry = { read: async () => raw, write: async (s, k, v) => { raw = v; }, flush: async () => {} };
  const identity = await createDeviceIdentityStore(registry, () => { throw new Error(); }).loadOrCreate();
  assert.match(identity.fingerprint, /^[a-f0-9]{64}$/);
});
