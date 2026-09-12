import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Streaming prototype for backend integration, not imported by the runtime.
 * Caller owns input/output streams and must discard partial output on failure.
 * Output is raw AES-128-CTR ciphertext; BrightSign interoperability untested.
 * Public metadata contains no key. keyMaterial belongs ONLY in a separate secret
 * store, never a manifest/log/SD object. SHA256 requires trusted metadata: it is
 * not a signature, MAC, or BrightSign AesCtrHmac framing.
 */
export async function encryptMedia(source, destination) {
  let key;
  do { key = randomBytes(16); } while (key.subarray(0, 8).equals(key.subarray(8)));
  const iv = randomBytes(16);
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      sizeBytes += chunk.length;
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(source, createCipheriv('aes-128-ctr', key, iv), counter, destination);
    if (sizeBytes === 0) throw new Error('Empty media input');
    return {
      manifest: {
        schemaVersion: 1,
        algorithm: 'AesCtr',
        sizeBytes,
        sha256: digest.digest('hex'),
        ivHex: iv.toString('hex'),
      },
      keyMaterial: key,
    };
  } catch {
    key.fill(0);
    throw new Error('Media encryption failed; discard partial destination');
  }
}

/** Key+IV bytes for the documented BrightSign interface; memory-only. */
export function playbackKeyBytes(key, ivHex) {
  if (!Buffer.isBuffer(key) || key.length !== 16
      || key.subarray(0, 8).equals(key.subarray(8))
      || typeof ivHex !== 'string' || !/^[0-9a-f]{32}$/i.test(ivHex)) {
    throw new Error('Invalid playback key material');
  }
  return Buffer.concat([key, Buffer.from(ivHex, 'hex')]);
}
