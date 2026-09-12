import { generateKeyPair, createPublicKey, createPrivateKey, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const generate = promisify(generateKeyPair);
const section = 'perform6_media_identity';
const name = 'identity_v1';

function decode(raw) {
  const record = JSON.parse(raw);
  if (record.version !== 1 || typeof record.privatePem !== 'string') throw new Error();
  const privateKey = createPrivateKey(record.privatePem);
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error();
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    fingerprint: createHash('sha256').update(publicDer).digest('hex'),
  };
}

// Local adapter, not wired into runtime. Caller must supply a verified registry
// adapter whose missing-entry result is null (never convert read errors to null).
// One instance per process. This is not cross-process registry locking.
export function createDeviceIdentityStore(registry, report = () => {}) {
  let pending;
  // Only fixed event names, stage and public fingerprint cross this boundary.
  // Diagnostics must never interrupt key persistence, even if transport fails.
  function emit(event, details = {}) {
    try { Promise.resolve(report(Object.freeze({ event, ...details }))).catch(() => {}); }
    catch { /* reporter failure does not change storage state */ }
  }
  function load(raw) {
    const identity = decode(raw);
    emit('KEY_IDENTITY_LOADED', { fingerprint: identity.fingerprint });
    return identity;
  }
  return {
    loadOrCreate() {
      if (!pending) pending = (async () => {
        let stage = 'read';
        try {
          const existing = await registry.read(section, name);
          if (existing !== null) return load(existing);
          stage = 'generate';
          const pair = await generate('rsa', { modulusLength: 2048 });
          const raw = JSON.stringify({ version: 1,
            privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
          // Check again after slow generation; never overwrite another record.
          const recheck = await registry.read(section, name);
          if (recheck !== null) return load(recheck);
          stage = 'write';
          await registry.write(section, name, raw);
          emit('KEY_REGISTRY_WRITE_OK');
          stage = 'flush';
          await registry.flush();
          emit('KEY_REGISTRY_FLUSH_OK');
          stage = 'readback';
          if (await registry.read(section, name) !== raw) throw new Error();
          const identity = decode(raw);
          emit('KEY_REGISTRY_READBACK_OK', { fingerprint: identity.fingerprint });
          return identity;
        } catch {
          emit('KEY_IDENTITY_FAILED', { stage });
          throw new Error('Device identity unavailable; no automatic reset');
        }
      })();
      // A rejected result stays latched; no automatic retry/regeneration.
      return pending;
    },
  };
}
