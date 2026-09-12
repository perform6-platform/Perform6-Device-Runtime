import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const autorun = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const syncEngine = fs.readFileSync('src/services/syncEngine.ts', 'utf8');
const sync = fs.readFileSync('src/services/sync.ts', 'utf8');
const mediaEncryption = fs.readFileSync('src/services/mediaEncryption.ts', 'utf8');
const runtime = fs.readFileSync('src/contexts/RuntimeContext.tsx', 'utf8');

function block(start, end) {
  const from = autorun.indexOf(start);
  const to = autorun.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing block ${start}`);
  return autorun.slice(from, to);
}

test('completed field probes cannot arm in production runtime', () => {
  assert.doesNotMatch(runtime, /startMediaKeyInteropProbe|startEncryptedPlaybackInteropProbe/);
  assert.doesNotMatch(autorun, /msgType = "p6-media-key-probe"|msgType = "p6-encrypted-playback-probe"/);
});

test('encrypted cache identity is reported separately and marked only after success', () => {
  assert.match(sync, /encryptedCachedMediaVersionIds:/);
  assert.match(syncEngine, /encryptedCachedMediaVersionIds\(verifiedCachedIds\)/);
  const firstMark = syncEngine.indexOf('markEncryptedMediaCached(item.mediaVersionId)');
  assert.ok(firstMark > syncEngine.indexOf('downloaded.includes(item.mediaVersionId)'));
  assert.doesNotMatch(mediaEncryption.match(/export function stageEncryptedMediaKeys[\s\S]*?\n\}/)?.[0] ?? '', /map\[item\.mediaVersionId\] =/);
});

test('native key preflight occurs before playback state mutation or StopClear', () => {
  const apply = block('Sub ApplyNativePlayback', 'End Sub');
  const preflight = apply.indexOf('P6EncryptedPlaybackReady(encryptionAssetId)');
  assert.ok(preflight > 0);
  assert.ok(preflight < apply.indexOf('st.loopMode ='));
  assert.ok(preflight < apply.indexOf('st.vp.StopClear()'));
  assert.match(apply, /encrypted-key-unavailable[\s\S]+return/);
});

test('production encrypted playback is native AES-CTR and cannot mutate boot or storage', () => {
  const play = block('Function PlayEncryptedNativeSrc', 'End Function');
  const store = block('Sub HandleP6MediaKeyStore', 'End Sub');
  assert.match(play, /params\.ProbeString = "mp4"/);
  assert.match(play, /params\.EncryptionAlgorithm = "AesCtr"/);
  assert.match(play, /params\.EncryptionKey = material/);
  assert.match(store, /section\.Flush\(\)/);
  assert.match(store, /stored-readback-ok/);
  for (const source of [play, store]) {
    assert.doesNotMatch(source, /FormatStorage|EncryptStorage|DeleteFile|RebootDevice|SetUrl|SetScreenModes/i);
  }
});

test('key material is never logged or placed in browser storage', () => {
  for (const call of mediaEncryption.matchAll(/console\.(?:info|warn|error)\(([^\n]*)/g)) {
    assert.doesNotMatch(call[1], /keyHex|ivHex|encryption/);
  }
  assert.doesNotMatch(mediaEncryption, /localStorage\.setItem\([^,]+,\s*(?:encryption|item\.encryption)/);
});
