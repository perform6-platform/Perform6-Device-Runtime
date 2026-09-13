import { constants, createHash, privateDecrypt, publicEncrypt } from 'node:crypto';

function binding(assetId, manifest) {
  if (typeof assetId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(assetId)
      || manifest?.algorithm !== 'AesCtr' || manifest.schemaVersion !== 1
      || !Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0
      || !/^[a-f0-9]{64}$/.test(manifest.sha256)
      || !/^[a-f0-9]{32}$/.test(manifest.ivHex)) throw new Error('Invalid asset binding');
  return Buffer.from(JSON.stringify([1, assetId, manifest.algorithm,
    manifest.sizeBytes, manifest.sha256, manifest.ivHex]));
}

// Backend prototype: public key MUST come from an approved immutable device
// enrollment, never a key supplied with a download request. No enrollment API
// is provided here. Stolen bearer tokens alone must not authorize replacement.
export function wrapMediaKey(pinnedPublicKey, assetId, manifest, mediaKey) {
  if (!Buffer.isBuffer(mediaKey) || mediaKey.length !== 16) throw new Error('Invalid media key');
  return publicEncrypt({ key: pinnedPublicKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256', oaepLabel: binding(assetId, manifest) }, mediaKey).toString('base64');
}

// Player prototype: private key resides only in internal registry/memory, never
// in the SD package, logs, backups, browser persistence or recovery response.
export function unwrapMediaKey(privateKey, assetId, manifest, wrappedKey) {
  try {
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256', oaepLabel: binding(assetId, manifest) }, Buffer.from(wrappedKey, 'base64'));
    if (plain.length !== 16) throw new Error();
    return plain;
  } catch { throw new Error('Media key verification failed'); }
}

// Manifest authenticity must be established separately (trusted server channel
// or signature). OAEP encryption itself does not authenticate the sender.
// Reopening a mutable file after this check also requires a TOCTOU mitigation.
export async function verifyCiphertext(source, manifest) {
  binding('verification', manifest);
  const digest = createHash('sha256');
  let length = 0;
  for await (const chunk of source) {
    length += chunk.length;
    if (length > manifest.sizeBytes) throw new Error('Ciphertext verification failed');
    digest.update(chunk);
  }
  if (length !== manifest.sizeBytes || digest.digest('hex') !== manifest.sha256) {
    throw new Error('Ciphertext verification failed');
  }
}
