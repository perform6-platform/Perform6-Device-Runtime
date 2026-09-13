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

test('encrypted rejection cannot mutate playback state or stop the proven source', () => {
  const apply = block('Sub ApplyNativePlayback', 'End Sub');
  const encryptedCall = apply.indexOf('encryptedOk = PlayEncryptedNativeSrc');
  const encryptedReject = apply.indexOf('if encryptedOk <> true', encryptedCall);
  const firstStateMutation = apply.indexOf('st.loopMode = requestedLoop');
  assert.ok(encryptedCall > 0 && encryptedReject > encryptedCall);
  assert.ok(encryptedReject < firstStateMutation);
  assert.doesNotMatch(apply.slice(encryptedCall, encryptedReject), /Stop|playingUrl\s*=|st\.nonce\s*=|st\.wantUrl\s*=/);
});

test('production encrypted playback uses the documented minimal AES-CTR contract and cannot mutate boot or storage', () => {
  const play = block('Function PlayEncryptedNativeSrc', 'End Function');
  const store = block('Sub HandleP6MediaKeyStore', 'End Sub');
  assert.doesNotMatch(play, /ProbeString/);
  assert.match(play, /params\.EncryptionAlgorithm = "AesCtr"/);
  assert.match(play, /params\.EncryptionKey = material/);
  assert.match(play, /P6NativeMediaDecryptionSupport\(\)/);
  assert.match(play, /reason=native-decryption-/);
  assert.match(play, /fileProbe = "miss"/);
  assert.doesNotMatch(play, /reason=file-unavailable/);
  assert.match(play, /reason=playfile-returned-false\|contract=official-minimal/);
  assert.match(store, /section\.Flush\(\)/);
  assert.match(store, /stored-readback-ok/);
  for (const source of [play, store]) {
    assert.doesNotMatch(source, /FormatStorage|EncryptStorage|DeleteFile|RebootDevice|SetUrl|SetScreenModes/i);
  }
});

test('native media-decryption capability probe is read-only and reported over existing telemetry', () => {
  const probe = block('Function P6NativeMediaDecryptionSupport', 'End Function');
  assert.match(probe, /HasFeature\("media decryption"\)/);
  assert.doesNotMatch(probe, /HasFeature\("media_decryption"\)/);
  assert.doesNotMatch(probe, /PlayFile|Write|Delete|Format|EncryptStorage|Reboot/i);
  const labProbe = block('Function P6LabProbeCryptoSupport', 'End Function');
  assert.match(labProbe, /probe\.mediaDecryption = P6NativeMediaDecryptionSupport\(\)/);
  assert.match(labProbe, /probe\.mediaDecryption = "supported" then probe\.ready = true/);
  assert.match(autorun, /encryptedMediaNativeDecryption/);
  assert.match(autorun, /nativeDecryption=/);
});

test('decoder error after native acceptance restores the prior HDMI-2 source', () => {
  assert.match(autorun, /st\.encryptedFallbackSrc = st\.playingUrl/);
  assert.match(autorun, /videoCode = 16[\s\S]+PlayNativeSrc\(ledState, restoreSrc, msgPort, ledStates\)/);
  assert.match(autorun, /state=decoder-error-restored/);
});

test('native acceptance without a decoder event times out back to the proven HDMI-2 source', () => {
  assert.match(autorun, /st\.encryptedPlaybackSpan = CreateObject\("roTimespan"\)/);
  assert.match(autorun, /encryptedPlaybackSpan\.TotalMilliseconds\(\) > 30000/);
  assert.match(autorun, /state=start-timeout-restored/);
});

test('key material is never logged or placed in browser storage', () => {
  for (const call of mediaEncryption.matchAll(/console\.(?:info|warn|error)\(([^\n]*)/g)) {
    assert.doesNotMatch(call[1], /keyHex|ivHex|encryption/);
  }
  assert.doesNotMatch(mediaEncryption, /localStorage\.setItem\([^,]+,\s*(?:encryption|item\.encryption)/);
});
