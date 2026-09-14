import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../../src/services/remoteCommandBridge.ts', import.meta.url), 'utf8');
const controls = await readFile(new URL('../../src/services/deviceRemoteControl.ts', import.meta.url), 'utf8');

assert.match(bridge, /const handledCommandIds = new Set<string>\(\)/);
assert.match(bridge, /if \(handledCommandIds\.has\(id\)\)/);
assert.match(bridge, /Duplicate remote command ignored/);
assert.match(bridge, /if \(!claimRemoteCommand\(command\)\) continue/);
assert.match(
  controls,
  /case 'SYNC_NOW':[\s\S]*?await runSyncNowHook\(\{[\s\S]*?forceOta,[\s\S]*?interrupt: true/,
);
assert.doesNotMatch(
  controls,
  /case 'SYNC_NOW':[\s\S]*?void runSyncNowHook\(\{[\s\S]*?forceOta/,
);

console.log('OTA remote-command deduplication gate passed.');
