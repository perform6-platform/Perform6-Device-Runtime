import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(
  new URL('../../src/services/remoteCommandBridge.ts', import.meta.url),
  'utf8',
);
const controls = await readFile(
  new URL('../../src/services/deviceRemoteControl.ts', import.meta.url),
  'utf8',
);
const realizer = await readFile(
  new URL('../../src/services/mediaRealize.ts', import.meta.url),
  'utf8',
);
const syncNowBlock = controls.slice(
  controls.indexOf("case 'SYNC_NOW':"),
  controls.indexOf("case 'CLEAR_SD_CACHE':"),
);

assert.match(bridge, /const handledCommandIds = new Set<string>\(\)/);
assert.match(bridge, /if \(handledCommandIds\.has\(id\)\)/);
assert.match(bridge, /if \(!claimRemoteCommand\(command\)\) continue/);
assert.match(
  syncNowBlock,
  /await runSyncNowHook\(\{[\s\S]*?interrupt: forceOta,[\s\S]*?cancelMedia: forceOta/,
);
assert.doesNotMatch(
  syncNowBlock,
  /interrupt: true,[\s\S]*?cancelMedia: true/,
);
assert.match(realizer, /new RealizerClass\(pool, MEDIA_STORE_NODE\)/);
assert.doesNotMatch(realizer, /new \(RealizerClass as AssetRealizerCtorA\)\(pool\)/);

console.log('Media sync command dedupe and XT AssetRealizer contract gate passed.');
