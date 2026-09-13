import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const autorun = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const js = fs.readFileSync('src/services/encryptedPlaybackInteropProbe.ts', 'utf8');
const fixturePath = 'brightsign/encryption-test/perform6-encrypted-probe.p6enc';

function block(start, end) {
  const from = autorun.indexOf(start);
  const to = autorun.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing block ${start}`);
  return autorun.slice(from, to);
}

test('probe is version-, profile-, heartbeat-, and single-attempt-gated', () => {
  assert.match(js, /CANDIDATE_VERSION = '1\.5\.51'/);
  assert.match(js, /heartbeatConfirmed !== true/);
  assert.match(js, /hardwareProfile !== 'XT2145'/);
  assert.match(js, /runtimeVersion !== CANDIDATE_VERSION/);
  assert.match(js, /attempted = true/);
  assert.doesNotMatch(js, /setInterval|location\.reload|RebootDevice|clearCache|DeleteFile|FormatStorage/i);
});

test('only the synthetic fixture is addressed and key material is never logged', () => {
  assert.match(js, /SD:\/perform6-encryption-test\/perform6-encrypted-probe\.p6enc/);
  assert.match(js, /type: 'p6-media-key-probe'/);
  assert.match(js, /type: 'p6-encrypted-playback-probe'/);
  for (const logCall of js.matchAll(/console\.(?:info|warn|error)\(([^\n]+)\)/g)) {
    assert.doesNotMatch(logCall[1], /LAB_KEY_HEX|LAB_IV_HEX|keyHex|ivHex/);
  }
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|writeFile|fetch\(/);
});

test('bundled fixture decrypts to an MP4 with the exact AES-128-CTR lab material', () => {
  const encrypted = fs.readFileSync(fixturePath);
  assert.ok(encrypted.length > 1024 && encrypted.length < 256 * 1024);
  const decipher = createDecipheriv(
    'aes-128-ctr',
    Buffer.from('4f8c2a7d90b1e3f6572849acdb0e1357', 'hex'),
    Buffer.from('a1c3e5f7092b4d6f8193a5c7e9fb1d2f', 'hex'),
  );
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  assert.equal(plain.subarray(4, 8).toString('ascii'), 'ftyp');
  assert.match(plain.toString('latin1', 0, 64), /isom|mp4/);
});

test('native probe validates reference and key before one encrypted PlayFile', () => {
  const native = block('Sub HandleP6EncryptedPlaybackProbe', 'End Sub');
  assert.match(native, /requestId <> "probe_1_5_51"/);
  assert.match(native, /requestedPath <> expectedPath/);
  assert.match(native, /P6LabReadPlaybackKey\(assetId\)/);
  assert.match(native, /material\.Count\(\) <> 32/);
  assert.match(native, /not IsPlayableNativeSrc\(st\.playingUrl\)/);
  assert.match(native, /params\.ProbeString = "mp4"/);
  assert.match(native, /params\.EncryptionAlgorithm = "AesCtr"/);
  assert.match(native, /params\.EncryptionKey = material/);
  assert.doesNotMatch(native, /P6NativeMediaDecryptionSupport/);
  assert.match(native, /if st\.encryptedProbeAttempted = true then/);
  assert.ok(native.indexOf('st.encryptedProbeAttempted = true') < native.indexOf('P6LabReadPlaybackKey(assetId)'));
  assert.equal((native.match(/\.PlayFile\(/g) ?? []).length, 1);
});

test('native probe is asynchronous and bounded without blocking heartbeat or OTA', () => {
  const native = block('Sub HandleP6EncryptedPlaybackProbe', 'End Sub');
  assert.match(native, /probeTimer\.SetElapsed\(8, 0\)/);
  assert.match(native, /probeTimer\.Start\(\)/);
  assert.doesNotMatch(native, /Sleep\(/);
  assert.doesNotMatch(native, /EncryptStorage|FormatStorage|FormatFileSystem|DeleteFile|WriteAsciiFile|Reboot|SetUrl|SetScreenModes/i);
});

test('success requires ordered Playing and MediaEnded events before restore', () => {
  const events = block('Function P6HandleEncryptedProbeVideoEvent', 'End Function');
  assert.match(events, /if st\.encryptedProbeActive <> true then return false/);
  assert.match(events, /if type\(ev\) <> "roVideoEvent" then return false/);
  assert.match(events, /if type\(st\.vp\) <> "roVideoPlayer" then return false/);
  assert.match(events, /ev\.GetSourceIdentity\(\) <> st\.vp\.GetIdentity\(\)/);
  assert.match(events, /videoCode = ev\.GetInt\(\)/);
  assert.match(events, /if videoCode = 3 then[\s\S]+encryptedProbeSawPlaying = true/);
  assert.match(events, /else if videoCode = 8 then[\s\S]+if st\.encryptedProbeSawPlaying = true then[\s\S]+"decoded-ended"/);
  assert.match(events, /pre-playing-ended-ignored/);
  assert.match(events, /else if videoCode = 16 then[\s\S]+"native-error"/);
  assert.match(events, /else if videoCode = 4 then[\s\S]+if st\.encryptedProbeSawPlaying = true then[\s\S]+"native-stopped"/);
  assert.match(events, /pre-playing-stopped-ignored/);
});

test('all terminal outcomes clear probe state before restoring plaintext or idle', () => {
  const restore = block('Function P6RestoreEncryptedPlaybackProbe', 'End Function');
  const clear = restore.indexOf('st.encryptedProbeActive = false');
  const play = restore.indexOf('restored = PlayLocalFile(st.vp, previousSrc)');
  assert.ok(clear > 0 && play > clear);
  assert.match(restore, /if playerReady and Len\(previousSrc\) > 0 then restored = PlayLocalFile/);
  assert.match(restore, /if restored then[\s\S]+else[\s\S]+PlayIdleClip\(st\)/);
  const timer = block('Function P6HandleEncryptedProbeTimer', 'End Function');
  assert.match(timer, /if type\(ev\) <> "roTimerEvent" then return false/);
  assert.match(timer, /GetSourceIdentity\(\) <> st\.encryptedProbeTimer\.GetIdentity\(\)/);
  assert.match(timer, /P6RestoreEncryptedPlaybackProbe\(st, "timeout"\)/);
});

test('normal SD reconciler cannot interrupt an active probe', () => {
  const poll = block('Sub MaybePollLedPlaybackFile', 'End Sub');
  assert.match(poll, /probeState\.encryptedProbeActive = true then return/);
  const direct = block('Sub ApplyNativePlayback', 'End Sub');
  assert.match(direct, /if st\.encryptedProbeActive = true then[\s\S]+deferred-encrypted-probe[\s\S]+return/);
});

test('server commands take priority over arming the post-heartbeat probe', () => {
  const runtime = fs.readFileSync('src/contexts/RuntimeContext.tsx', 'utf8');
  assert.match(runtime, /if \(result\.remoteCommands\?\.length\) \{[\s\S]+processRemoteCommands[\s\S]+\} else \{[\s\S]+startEncryptedPlaybackInteropProbe\(true\)/);
});

test('malformed native dependencies fail before timer or playback calls', () => {
  const native = block('Sub HandleP6EncryptedPlaybackProbe', 'End Sub');
  assert.ok(native.indexOf('type(msgPort) <> "roMessagePort"') < native.indexOf('probeTimer.SetPort(msgPort)'));
  const restore = block('Function P6RestoreEncryptedPlaybackProbe', 'End Function');
  assert.match(restore, /playerReady = \(type\(st\.vp\) = "roVideoPlayer"\)/);
  assert.match(restore, /if playerReady and Len\(previousSrc\) > 0 then restored = PlayLocalFile/);
});

test('fixture command is reachable on both existing native event shapes', () => {
  assert.equal((autorun.match(/msgType = "p6-encrypted-playback-probe"/g) ?? []).length, 2);
  assert.equal((autorun.match(/HandleP6EncryptedPlaybackProbe\(payload, ledState, msgPort\)/g) ?? []).length, 2);
});
