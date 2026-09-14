import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const autorun = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const syncEngine = fs.readFileSync('src/services/syncEngine.ts', 'utf8');
const sync = fs.readFileSync('src/services/sync.ts', 'utf8');
const mediaEncryption = fs.readFileSync('src/services/mediaEncryption.ts', 'utf8');
const sdCacheBridge = fs.readFileSync('src/services/sdCacheBridge.ts', 'utf8');
const runtime = fs.readFileSync('src/contexts/RuntimeContext.tsx', 'utf8');
const homeHero = fs.readFileSync('src/components/home/HomeHeroVideo.tsx', 'utf8');
const runtimeStore = fs.readFileSync('src/stores/runtimeStore.ts', 'utf8');
const xtOutputBridge = fs.readFileSync('src/platform/xtOutputBridge.ts', 'utf8');
const ledPlaybackFile = fs.readFileSync('src/platform/ledPlaybackFile.ts', 'utf8');

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

test('verified encrypted URL cannot be replaced by the plaintext manifest fallback', () => {
  const start = sdCacheBridge.indexOf('export function resolveSdPlaybackUrl(');
  const end = sdCacheBridge.indexOf('\nexport function cacheFileNameForMedia', start);
  assert.ok(start >= 0 && end > start, 'resolveSdPlaybackUrl source must exist');
  const resolve = sdCacheBridge.slice(start, end);
  const verified = resolve.indexOf('const readyUrl = getSdCachedUrl(mediaVersionId)');
  const plaintextRepair = resolve.indexOf(
    'fallbackFileUrl && realizePoolPathToCache(mediaVersionId, fallbackFileUrl)',
  );
  assert.ok(verified >= 0 && plaintextRepair >= 0);
  assert.ok(
    verified < plaintextRepair,
    'sync-verified representation must win before legacy plaintext repair',
  );
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
  const firstStateMutation = apply.indexOf('st.loopMode = requestedLoop', encryptedReject);
  assert.ok(encryptedCall > 0 && encryptedReject > encryptedCall);
  assert.ok(encryptedReject < firstStateMutation);
  assert.doesNotMatch(apply.slice(encryptedCall, encryptedReject), /Stop|playingUrl\s*=|st\.nonce\s*=|st\.wantUrl\s*=/);
});

test('production encrypted MP4 playback uses the field-proven container hint and cannot mutate boot or storage', () => {
  const play = block('Function PlayEncryptedNativeSrc', 'End Function');
  const store = block('Sub HandleP6MediaKeyStore', 'End Sub');
  assert.match(play, /params\.ProbeString = "mp4"/);
  assert.ok(play.indexOf('params.ProbeString = "mp4"') < play.indexOf('st.vp.PlayFile(params)'));
  assert.match(play, /params\.EncryptionAlgorithm = "AesCtr"/);
  assert.match(play, /params\.EncryptionKey = material/);
  assert.match(play, /P6NativeMediaDecryptionSupport\(\)/);
  assert.doesNotMatch(play, /nativeDecryption <> "supported"/);
  assert.doesNotMatch(play, /reason=native-decryption-/);
  assert.match(play, /P6ProductionEncryptedAssetAllowed\(assetId\)/);
  assert.match(play, /fileProbe = "miss"/);
  assert.doesNotMatch(play, /reason=file-unavailable/);
  assert.match(play, /reason=playfile-returned-false\|contract=encrypted-mp4-probe/);
  assert.match(store, /section\.Flush\(\)/);
  assert.match(store, /stored-readback-ok/);
  for (const source of [play, store]) {
    assert.doesNotMatch(source, /FormatStorage|EncryptStorage|DeleteFile|RebootDevice|SetUrl|SetScreenModes/i);
  }
});

test('production playback accepts only API-authorized media with a staged native key', () => {
  const allowlist = block('Function P6ProductionEncryptedAssetAllowed', 'End Function');
  const apply = block('Sub ApplyNativePlayback', 'End Sub');
  assert.match(allowlist, /return P6MediaAssetIdValid\(assetId\)/);
  assert.match(apply, /P6ProductionEncryptedAssetAllowed\(encryptionAssetId\)/);
  assert.match(apply, /asset-id-invalid/);
  assert.ok(
    apply.indexOf('P6ProductionEncryptedAssetAllowed(encryptionAssetId)') <
      apply.indexOf('P6EncryptedPlaybackReady(encryptionAssetId)'),
  );
});

test('XT command ordering rejects stale commands without touching playback state', () => {
  const apply = block('Sub ApplyNativePlayback', 'End Sub');
  const guard = apply.indexOf('restartNonce < st.nonce');
  const playableGate = apply.indexOf('if not IsPlayableNativeSrc(src)');
  const encryptedCall = apply.indexOf('encryptedOk = PlayEncryptedNativeSrc');
  assert.ok(guard > 0 && guard < playableGate && guard < encryptedCall);
  const staleBlock = apply.slice(guard, apply.indexOf('end if', guard));
  assert.match(staleBlock, /stale-command-ignored/);
  assert.match(staleBlock, /return/);
  assert.doesNotMatch(staleBlock, /st\.nonce\s*=|st\.playingUrl\s*=|StopClear|PlayFile|WriteXtPlaybackStatus/);
});

test('duplicate encrypted command is transport-only and cannot restart the decoder', () => {
  const apply = block('Sub ApplyNativePlayback', 'End Sub');
  const duplicate = apply.indexOf(
    'restartNonce = st.nonce and src = st.playingUrl and st.encryptedPlaybackActive = true',
  );
  const encryptedCall = apply.indexOf('encryptedOk = PlayEncryptedNativeSrc');
  assert.ok(duplicate > 0 && duplicate < encryptedCall);
  const duplicateBlock = apply.slice(duplicate, apply.indexOf('end if', duplicate));
  assert.match(duplicateBlock, /already-playing-encrypted-transport/);
  assert.match(duplicateBlock, /return/);
  assert.doesNotMatch(duplicateBlock, /PlayEncryptedNativeSrc|StopClear|st\.nonce\s*=/);
});

test('native media-decryption capability probe is read-only and reported over existing telemetry', () => {
  const probe = block('Function P6NativeMediaDecryptionSupport', 'End Function');
  assert.match(probe, /HasFeature\("media decryption"\)/);
  assert.doesNotMatch(probe, /HasFeature\("media_decryption"\)/);
  assert.match(probe, /return "unreported-field-verified"/);
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

test('Bluefin HDMI-1 configures documented AES-CTR HTML attributes before src', () => {
  const algorithm = homeHero.indexOf(
    "video.setAttribute('EncryptionAlgorithm', encryption.algorithm)",
  );
  const key = homeHero.indexOf(
    "video.setAttribute('EncryptionKey', encryption.keyAndIvHex)",
  );
  const src = homeHero.indexOf('video.src = playSrc');
  assert.ok(algorithm >= 0 && key > algorithm && src > key);
  assert.match(homeHero, /video\.removeAttribute\('EncryptionKey'\)/);
  assert.match(mediaEncryption, /const htmlPlaybackKeys = new Map/);
  assert.match(mediaEncryption, /keyAndIvHex: encryption\.keyHex \+ encryption\.ivHex/);
  assert.match(mediaEncryption, /htmlPlaybackKeys\.delete\(id\)/);
});

test('post-reload XT commands advance above the last native nonce', () => {
  assert.match(runtimeStore, /ensureDisplayRestartNonceAtLeast/);
  assert.match(runtimeStore, /displayRestartNonce < safeMinimum/);
  const align = xtOutputBridge.slice(
    xtOutputBridge.indexOf('function alignRestartNonceWithNativeStatus'),
    xtOutputBridge.indexOf('\nfunction buildPayload'),
  );
  assert.match(align, /accepted <= state\.displayRestartNonce/);
  assert.match(align, /ensureDisplayRestartNonceAtLeast\(accepted \+ 1\)/);
  assert.match(xtOutputBridge, /alignRestartNonceWithNativeStatus\(readXtPlaybackStatus\(\)\)/);
  assert.match(
    ledPlaybackFile,
    /restartNonce:\s*status\.restartNonce\s*\?\?\s*status\.restartnonce/,
  );
});

test('cache completion replay is scoped and encrypted-ready is edge-triggered', () => {
  assert.match(
    xtOutputBridge,
    /event\.mediaVersionId === currentMediaVersionId/,
  );
  assert.match(
    xtOutputBridge,
    /mediaVersionId === useRuntimeStore\.getState\(\)\.displayPlaybackMeta\?\.mediaVersionId/,
  );
  assert.match(mediaEncryption, /const alreadyMarked =/);
  assert.match(mediaEncryption, /if \(alreadyMarked\) return/);
});
