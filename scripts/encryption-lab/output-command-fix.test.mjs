import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('capture success follows the newly written JPEG, never a stale file or return-value guess', () => {
  const autorun = read('brightsign/autorun.brs');
  const handler = autorun.match(
    /Sub HandleP6ScreenCapture\(payload as Object\)([\s\S]*?)End Sub/,
  )?.[1];
  assert.ok(handler);
  const removeAt = handler.indexOf('DeleteFile("SD:/perform6-screen-capture.jpg")');
  const screenshotAt = handler.indexOf('nativeReturn = vm.Screenshot(params)');
  const statAt = handler.indexOf(
    'captureBytes = PartFileBytes("SD:/perform6-screen-capture.jpg")',
  );
  const markerAt = handler.indexOf(
    'AtomicWriteAsciiFile("SD:/perform6-screen-capture-result.json"',
  );
  assert.ok(removeAt >= 0 && removeAt < screenshotAt);
  assert.ok(screenshotAt < statAt && statAt < markerAt);
  assert.match(handler, /if captureBytes >= 4\.0 then ok = true/);
  assert.doesNotMatch(handler, /if nativeReturn = true then ok = true/);

  const uploader = read('src/services/screenCapture.ts');
  assert.match(uploader, /result\.ok === true/);
  assert.match(uploader, /fileBytes >= 4/);
  assert.match(uploader, /bytes\[0\] !== 0xff/);
});

test('fast command delivery is observable, prompt, and retains heartbeat fallback', () => {
  const poller = read('src/services/remoteCommandPoller.ts');
  assert.match(poller, /const POLL_MS = 10_000/);
  assert.match(poller, /const FIRST_POLL_DELAY_MS = 500/);
  assert.match(poller, /Fast remote commands received/);
  assert.match(poller, /Fast remote command poll failed; heartbeat fallback remains active/);
  assert.doesNotMatch(poller, /setInterval\([^,]+,\s*60_000/);

  const bridge = read('src/services/remoteCommandBridge.ts');
  assert.match(bridge, /deferredUiCommands/);
  assert.match(bridge, /Fast remote commands deferred until UI ready/);
  assert.match(bridge, /Fast remote commands released to UI/);
  assert.match(bridge, /runtimeConfig\.hardwareProfile !== 'XT2145'/);

  const home = read('src/pages/Home.tsx');
  assert.match(home, /pendingRemoteSlotRef/);
  assert.match(home, /Remote slot deferred until manifest is ready/);
  assert.match(home, /Deferred remote slot now ready/);
  assert.match(home, /runtimeConfig\.hardwareProfile === 'XT2145'/);
});

test('capture and fast-command changes cannot invoke protected lifecycle operations', () => {
  const bodies = [
    read('src/services/screenCapture.ts'),
    read('src/services/remoteCommandPoller.ts'),
    read('src/services/remoteCommandBridge.ts'),
  ].join('\n');
  for (const forbidden of [
    'rebootViaBrightSignSystem',
    'requestDeviceReboot',
    'cancelOtaInstall',
    'rmTreeSync',
  ]) {
    assert.doesNotMatch(bodies, new RegExp(forbidden));
  }
});
