import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEncryptionReadiness } from './readiness.mjs';
const health = { heartbeat: true, ota: true, bootComplete: true };
const ack = { requestId: 'trial-1', protocol: 1, encryptedPlayback: true, secretFreeTransport: true };
const options = () => ({ readHealth: async () => health, probe: async () => ack, requestId: 'trial-1', timeoutMs: 20 });
test('requires full health and correlated explicit capabilities', async () => {
  assert.deepEqual(await assessEncryptionReadiness(options()), { ready: true });
});
test('empty, stale, wrong protocol and missing capability deny readiness', async () => {
  for (const value of [null, {}, { ...ack, requestId: 'old' }, { ...ack, protocol: 2 },
    { ...ack, encryptedPlayback: false }, { ...ack, secretFreeTransport: false }]) {
    assert.deepEqual(await assessEncryptionReadiness({ ...options(), probe: async () => value }), { ready: false });
  }
});
test('health loss during probe denies readiness', async () => {
  let reads = 0;
  assert.deepEqual(await assessEncryptionReadiness({ ...options(), readHealth: async () => ++reads === 1 ? health : {} }), { ready: false });
});
test('never-settling handshake times out while other work continues', async () => {
  let otherWorkRan = false;
  const promise = assessEncryptionReadiness({ ...options(), probe: () => new Promise(() => {}) });
  await Promise.resolve().then(() => { otherWorkRan = true; });
  assert.deepEqual(await promise, { ready: false });
  assert.equal(otherWorkRan, true);
});
test('late acknowledgement cannot change returned result', async () => {
  let finish;
  const result = await assessEncryptionReadiness({ ...options(), probe: () => new Promise(resolve => { finish = resolve; }) });
  finish(ack);
  await Promise.resolve();
  assert.deepEqual(result, { ready: false });
  assert.ok(Object.isFrozen(result));
});
test('adapter errors and invalid configuration deny readiness without leaking errors', async () => {
  assert.deepEqual(await assessEncryptionReadiness({ ...options(), probe: () => { throw new Error('secret'); } }), { ready: false });
  assert.deepEqual(await assessEncryptionReadiness({ ...options(), timeoutMs: 0 }), { ready: false });
});
