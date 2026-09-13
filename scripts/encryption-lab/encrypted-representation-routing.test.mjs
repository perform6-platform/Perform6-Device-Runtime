import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(
  path.join(root, 'src/services/sdCacheBridge.ts'),
  'utf8',
);
const syncEngine = fs.readFileSync(
  path.join(root, 'src/services/syncEngine.ts'),
  'utf8',
);

test('verified encrypted representation wins over the plaintext manifest fallback', () => {
  const start = source.indexOf('export function resolveSdPlaybackUrl(');
  const end = source.indexOf('\nexport function cacheFileNameForMedia', start);
  assert.ok(start >= 0 && end > start, 'resolveSdPlaybackUrl source must exist');

  const body = source.slice(start, end);
  const readyLookup = body.indexOf('const readyUrl = getSdCachedUrl(mediaVersionId)');
  const fallbackRepair = body.indexOf(
    'fallbackFileUrl && realizePoolPathToCache(mediaVersionId, fallbackFileUrl)',
  );

  assert.ok(readyLookup >= 0, 'verified representation lookup must exist');
  assert.ok(fallbackRepair >= 0, 'legacy fallback repair must remain available');
  assert.ok(
    readyLookup < fallbackRepair,
    'verified representation must be resolved before probing the plaintext fallback',
  );
});

test('stale plaintext mapping is repaired only after exact encrypted SD representation verification', () => {
  const start = source.indexOf('export async function reconcileEncryptedSdRepresentations(');
  const end = source.indexOf('\nfunction prefetchRole()', start);
  assert.ok(start >= 0 && end > start, 'encrypted representation repair must exist');

  const body = source.slice(start, end);
  assert.match(body, /items\.filter\(\(item\) => Boolean\(item\.encryption\)\)/);
  assert.match(body, /const expectedName = cacheNameFor\(expectedUrl\)/);
  assert.match(body, /const actualBytes = onDisk\.get\(expectedName\) \?\? 0/);
  assert.match(body, /actualBytes === declaredBytes/);
  assert.ok(
    body.indexOf('if (!sizeVerified) continue') <
      body.indexOf('markSdCached(item.mediaVersionId, expectedUrl)'),
    'mapping mutation must happen only after exact-file verification',
  );
  assert.doesNotMatch(
    body,
    /\b(?:rmTreeSync|unlinkSync|evictCachedMedia|downloadMediaBatchToSd)\s*\(/,
  );
});

test('sync repairs encrypted representation before building or publishing manifest', () => {
  const repair = syncEngine.indexOf('await reconcileEncryptedSdRepresentations(');
  const manifest = syncEngine.indexOf('const manifest = buildRuntimeManifest(');
  assert.ok(repair >= 0, 'sync engine must invoke encrypted representation repair');
  assert.ok(manifest >= 0, 'manifest build must exist');
  assert.ok(repair < manifest, 'repair must precede manifest publication/playback');
  assert.match(
    syncEngine.slice(repair, manifest),
    /for \(const id of repairedEncryptedIds\) markEncryptedMediaCached\(id\)/,
  );
  assert.match(
    syncEngine.slice(repair, manifest),
    /catch \(error\)[\s\S]*Encrypted SD representation repair failed safely/,
    'repair failure must not abort sync, heartbeat, or OTA control',
  );
});
