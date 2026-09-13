import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const autorun = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const js = fs.readFileSync('src/services/mediaKeyInteropProbe.ts', 'utf8');
const runtime = fs.readFileSync('src/contexts/RuntimeContext.tsx', 'utf8');

const nativeHandler = autorun.match(/Sub HandleP6MediaKeyProbe\([^]*?\nEnd Sub/)?.[0];

test('probe is strictly post-heartbeat and version/profile gated', () => {
  assert.match(runtime, /sendDeviceHeartbeat\([^]*?\.then\(\(result\) => \{[^]*?try \{\s+startMediaKeyInteropProbe\(true\);/);
  assert.ok(runtime.indexOf('setHeartbeat({ at: new Date().toISOString(), ok: true })') < runtime.indexOf('startMediaKeyInteropProbe(true)'));
  assert.ok(runtime.indexOf('result.remoteCommands?.length') < runtime.indexOf('startMediaKeyInteropProbe(true)'));
  assert.match(runtime, /if \(result\.remoteCommands\?\.length\) \{[^]*?processRemoteCommands[^]*?\} else \{[^]*?startMediaKeyInteropProbe\(true\)/);
  assert.match(js, /heartbeatConfirmed !== true/);
  assert.match(js, /runtimeConfig\.runtimeVersion !== CANDIDATE_VERSION/);
  assert.match(js, /runtimeConfig\.hardwareProfile !== 'XT2145'/);
  const starter = js.match(/export function startMediaKeyInteropProbe\([^]*?\n\}/)?.[0];
  assert.ok(starter);
  assert.match(starter, /attempted = true/);
  assert.ok(starter.indexOf('attempted = true') < starter.indexOf('randomHex16()'));
});

test('JavaScript sends one in-memory key command without logging material', () => {
  assert.equal((js.match(/PostBSMessage\(/g) ?? []).length, 1);
  assert.match(js, /globalThis\.crypto\.getRandomValues/);
  assert.match(js, /type: 'p6-media-key-probe'/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|writeFile|fetch\(/);
  for (const logCall of js.matchAll(/console\.(?:info|warn|error)\(([^\n]*)/g)) {
    assert.doesNotMatch(logCall[1], /keyHex|ivHex|payload|record/);
  }
});

test('native handler validates, flushes and independently reads the reserved record', () => {
  assert.ok(nativeHandler, 'native handler missing');
  assert.match(nativeHandler, /requestId = "probe_1_5_44" and assetId = "probe_1_5_44"/);
  assert.match(nativeHandler, /if allowedId <> true then/);
  assert.match(nativeHandler, /not P6LabIsHex32\(keyHex\) or not P6LabIsHex32\(ivHex\)/);
  assert.match(nativeHandler, /section\.Write\("asset_" \+ assetId, FormatJson\(record\)\)/);
  assert.match(nativeHandler, /if wrote = true then flushed = section\.Flush\(\)/);
  assert.match(nativeHandler, /P6LabReadPlaybackKey\(assetId\)/);
  assert.match(nativeHandler, /state = "stored-readback-ok"/);
  assert.match(nativeHandler, /secretLogged=0/);
});

test('probe failure cannot mutate SD/media or affect boot, OTA or reboot', () => {
  assert.ok(nativeHandler);
  assert.doesNotMatch(nativeHandler, /PlayFile|EncryptStorage|FormatStorage|FormatFileSystem|DeleteFile|WriteAsciiFile|Reboot|SetUrl|SetScreenModes/i);
  assert.doesNotMatch(js, /reboot|encrypt|format|delete|unlink|rmSync|SetUrl/i);
  assert.equal((autorun.match(/msgType = "p6-media-key-probe"/g) ?? []).length, 2);
});
