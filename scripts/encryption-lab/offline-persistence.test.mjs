import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const autorun = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const cache = fs.readFileSync('src/services/playbackManifestCache.ts', 'utf8');
const runtime = fs.readFileSync('src/contexts/RuntimeContext.tsx', 'utf8');
const overlay = fs.readFileSync('src/components/status/DeviceStatusOverlay.tsx', 'utf8');
const syncEngine = fs.readFileSync('src/services/syncEngine.ts', 'utf8');

const widgetFactory = autorun.match(
  /Function TryCreateHtmlWidget\([^]*?\nEnd Function/,
)?.[0];

test('every roHtmlWidget constructor uses the stable persistent storage path', () => {
  assert.ok(widgetFactory, 'widget factory missing');
  assert.match(
    autorun,
    /Function HtmlPersistentStoragePath\(\) as String[^]*?return "\/\.\/perform6-browser-storage"[^]*?End Function/,
  );
  for (const cfg of ['cfg', 'cfg2', 'cfg3']) {
    assert.match(
      widgetFactory,
      new RegExp(`${cfg}\\.storage_path = HtmlPersistentStoragePath\\(\\)`),
    );
  }
});

test('classic widget fallback configures persistence before loading the app', () => {
  assert.ok(widgetFactory);
  const classic = widgetFactory.slice(
    widgetFactory.indexOf('html = CreateObject("roHtmlWidget", rect)'),
  );
  const storageIndex = classic.indexOf(
    'html.SetLocalStorageDir(HtmlPersistentStoragePath())',
  );
  assert.ok(storageIndex >= 0, 'classic persistent storage call missing');
  assert.ok(storageIndex < classic.indexOf('html.SetUrl(url)'));
});

test('offline cache stores only schedule inputs and recalculates rotation', () => {
  assert.match(cache, /type OfflineManifestSource = Pick</);
  for (const required of [
    "'device'",
    "'deployment'",
    "'config'",
    "'playbackManifest'",
    "'targetManifest'",
    "'schedule'",
  ]) assert.match(cache, new RegExp(required));
  assert.match(cache, /source:\s*syncData \? offlineSource\(syncData\) : undefined/);
  assert.doesNotMatch(cache, /JSON\.stringify\(syncData\)/);
  assert.doesNotMatch(cache, /keyHex|ivHex|requiredMedia|retainMediaVersionIds/);
  assert.match(cache, /rotationStartDate: syncData\.device\.rotationStartDate/);
  assert.doesNotMatch(cache, /currentRotationDay: syncData\.device\.currentRotationDay/);
  assert.match(cache, /buildRuntimeManifest\(/);
});

test('only a completed successful sync replaces the persistent offline schedule', () => {
  assert.match(
    runtime,
    /if \(result\.manifest\) \{[^]*?savePlaybackManifestCache\(\s*result\.manifest,\s*result\.syncData,\s*info\.hardwareProfile/,
  );
  const early = runtime.match(/onManifest: \(earlyManifest\) => \{[^]*?\n\s*\},/)?.[0];
  assert.ok(early, 'early manifest callback missing');
  assert.doesNotMatch(early, /savePlaybackManifestCache/);
  assert.match(runtime, /loadPlaybackManifestCache\(deviceInfo\.hardwareProfile\)/);
});

test('network-only sync failure keeps a valid cached schedule active', () => {
  assert.match(
    syncEngine,
    /offlineUnavailable: e instanceof ApiError && e\.status === 0/,
  );
  assert.match(
    runtime,
    /const offlineManifest = result\.offlineUnavailable[^]*?loadPlaybackManifestCache\(info\.hardwareProfile\)/,
  );
  assert.match(
    runtime,
    /if \(offlineManifest\) \{[^]*?setPlaybackManifest\(offlineManifest\)[^]*?error: null,[^]*?runtimePhase: 'ready'[^]*?setConnectionStatus\('offline'\)/,
  );
});

test('non-network sync failures remain fatal even when a cache exists', () => {
  const fallbackStart = runtime.indexOf('const offlineManifest = result.offlineUnavailable');
  const fatalStart = runtime.indexOf("runtimePhase: 'error'", fallbackStart);
  assert.ok(fallbackStart >= 0, 'offline fallback missing');
  assert.ok(fatalStart > fallbackStart, 'fatal fallback must remain after offline branch');
  assert.match(
    runtime.slice(fallbackStart, fatalStart + 80),
    /error: result\.error \?\? 'Sync failed',[^]*?runtimePhase: 'error'/,
  );
});

test('network overlay never covers a usable cached runtime', () => {
  assert.match(
    overlay,
    /const hasPlaybackManifest = useRuntimeStore\([^]*?playbackState\.manifest\?\.screens\?\.length/,
  );
  assert.match(
    overlay,
    /!hasPlaybackManifest[^]*?health === 'offline'/,
  );
});

test('restored network resynchronizes a paired runtime instead of re-pairing', () => {
  assert.match(
    overlay,
    /prior === 'offline' && health === 'online' && isReady[^]*?runSyncNow\(\)/,
  );
  assert.match(
    overlay,
    /if \(isReady\) \{\s*await runSyncNow\(\);\s*\} else if[^]*?retryPairing\(\)/,
  );
});
