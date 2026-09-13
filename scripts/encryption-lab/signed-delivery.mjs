import { constants, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

// Offline prototype. The verification key must be pinned in trusted runtime
// configuration, never accepted from the manifest. Signatures do not prevent
// replay of an older valid delivery: version/revocation policy is separate.
function bytes(delivery) {
  const { assetId, recipientFingerprint, manifest: m, wrappedKey } = delivery ?? {};
  if (!/^[a-z0-9_-]{1,80}$/.test(assetId ?? '')
    || !/^[a-f0-9]{64}$/.test(recipientFingerprint ?? '')
    || m?.schemaVersion !== 1 || m.algorithm !== 'AesCtr'
    || !Number.isSafeInteger(m.sizeBytes) || m.sizeBytes <= 0
    || !/^[a-f0-9]{64}$/.test(m.sha256 ?? '')
    || !/^[a-f0-9]{32}$/.test(m.ivHex ?? '')
    || typeof wrappedKey !== 'string' || wrappedKey.length > 2048
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(wrappedKey)
    || Buffer.from(wrappedKey, 'base64').toString('base64') !== wrappedKey) throw new Error('Invalid delivery');
  return Buffer.from(JSON.stringify([1, assetId, recipientFingerprint,
    m.schemaVersion, m.algorithm, m.sizeBytes, m.sha256, m.ivHex, wrappedKey]));
}

function rsa(key) {
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error('Invalid signing key');
  }
  return { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
}

export function signDelivery(privatePem, delivery) {
  return sign('sha256', bytes(delivery), rsa(createPrivateKey(privatePem))).toString('base64');
}

// Returns a fresh normalized snapshot, never the caller's mutable object.
// Only this snapshot should be used for hash verification and unwrapping.
export function verifyDelivery(publicPem, delivery, signature, expectedFingerprint) {
  try {
    const payload = bytes(delivery);
    if (typeof signature !== 'string' || signature.length > 2048
      || Buffer.from(signature, 'base64').toString('base64') !== signature
      || !verify('sha256', payload, rsa(createPublicKey(publicPem)), Buffer.from(signature, 'base64'))) throw new Error();
    const [, assetId, recipientFingerprint, schemaVersion, algorithm, sizeBytes, sha256, ivHex, wrappedKey] = JSON.parse(payload);
    if (recipientFingerprint !== expectedFingerprint) throw new Error();
    return Object.freeze({ assetId, recipientFingerprint, wrappedKey,
      manifest: Object.freeze({ schemaVersion, algorithm, sizeBytes, sha256, ivHex }) });
  } catch { throw new Error('Delivery signature verification failed'); }
}
