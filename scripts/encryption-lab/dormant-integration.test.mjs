import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const baseline = execFileSync('git', ['show', 'c7011b5:brightsign/autorun.brs'], { encoding: 'utf8' });
const marker = "\n' Encryption remains disabled. Hello invokes only the read-only constructor\n";

test('diagnostic mode matching rejects 4K30, interlaced, malformed and missing modes', () => {
  const helper = source.match(/Function DiagnosticModeIs60p\([^]*?\nEnd Function/)[0];
  // Pin this small pure helper to the equivalent model tested below. This is
  // not execution on BrightSign OS; the package also receives parser checks.
  assert.equal(helper, `Function DiagnosticModeIs60p(modeText as String, dimensions as String) as Boolean
  mode = LCase(modeText)
  suffix = Instr(1, mode, ":")
  if suffix > 0 then mode = Left(mode, suffix - 1)
  return mode = dimensions + "x60p" or mode = dimensions + "x59.94p"
End Function`);
  const matches = (mode, dimensions) => {
    const base = mode.toLowerCase().split(':')[0];
    return base === dimensions + 'x60p' || base === dimensions + 'x59.94p';
  };
  for (const mode of ['3840x2160x60p:fullres', '3840x2160x59.94p', '3840X2160X60P']) {
    assert.equal(matches(mode, '3840x2160'), true, mode);
  }
  for (const mode of ['', '3840x2160x30p', '3840x2160x24p:fullres', '3840x2160x60i', '3840x2160x600p', '5760x2160x60p', '1920x1080x60p']) {
    assert.equal(matches(mode, '3840x2160'), false, mode);
  }
  assert.equal(matches('1920x1080x60p:fullres', '1920x1080'), true);
  assert.equal(matches('1920x1080x30p', '1920x1080'), false);
});

test('only reviewed diagnostics, probe helpers and widget-port binding differ from 1.5.23 autorun', () => {
  const parts = source.split(marker);
  assert.equal(parts.length, 2);
  let stripped = parts[0].replace(
    /  ' Read-only capability probe\.[\s\S]*?  msg\.AddReplace\("encryptedMediaKeyContainer", cryptoProbe\.keyContainer\)\n/,
    '',
  ).replace(
    /    ' Independent SD-log evidence; contains no key material and does not\n    ' depend on the JS return channel\. Constructor readiness is not playback\.\n    LedLog\("MEDIA\|PROBE\|disabled\|registry=" \+ cryptoProbe\.registry \+ "\|keyContainer=" \+ cryptoProbe\.keyContainer\)\n/,
    '',
  ).replace(
    /            else if msgType = "p6-media-key-probe" then\n              HandleP6MediaKeyProbe\(payload\)\n/,
    '',
  ).replace(
    /        else if msgType = "p6-media-key-probe" then\n          HandleP6MediaKeyProbe\(payload\)\n/,
    '',
  ).replace(
    /            else if msgType = "p6-encrypted-playback-probe" then\n              HandleP6EncryptedPlaybackProbe\(payload, ledState, msgPort\)\n/,
    '',
  ).replace(
    /        else if msgType = "p6-encrypted-playback-probe" and profile = "XT2145" then\n          HandleP6EncryptedPlaybackProbe\(payload, ledState, msgPort\)\n/,
    '',
  );
  stripped = stripped.replace(
    /  st\.encryptedProbeActive = false\n  st\.encryptedProbeAttempted = false\n  st\.encryptedProbeSawPlaying = false\n  st\.encryptedProbePreviousSrc = ""\n  st\.encryptedProbePreviousLoop = true\n  st\.encryptedProbePreviousPaused = false\n  st\.encryptedProbeTimer = invalid\n/,
    '',
  ).replace(
    /  if st\.encryptedProbeActive = true then\n    TraceLog\("PLAY\|deferred\|encrypted-probe-active"\)\n    WriteXtPlaybackStatus\(st, "deferred-encrypted-probe", false\)\n    return\n  end if\n/,
    '',
  ).replace(
    /  ' An encrypted playback probe temporarily owns the same HDMI-2 player\.[\s\S]*?      if probeState\.encryptedProbeActive = true then return\n    end if\n  end for\n/,
    '',
  ).replace(
    /      encryptedProbeHandled = P6HandleEncryptedProbeVideoEvent\(ev, ledState\)\n      ' 8 = MediaEnded - notify touch UI for non-looping XT playback\. Probe\n      ' events are consumed locally and must not look like customer media end\.\n      if encryptedProbeHandled <> true and videoCode = 8 and profile = "XT2145" and type\(htmlTouch\) = "roHtmlWidget" then/,
    '      \' 8 = MediaEnded - notify touch UI for non-looping XT playback.\n' +
    '      if videoCode = 8 and profile = "XT2145" and type(htmlTouch) = "roHtmlWidget" then',
  ).replace(
    /      isEncryptedProbeTimer = P6HandleEncryptedProbeTimer\(ev, ledState\)\n/,
    '',
  ).replace(
    /      if isEncryptedProbeTimer then\n        TraceLog\("MAIN\|encrypted-probe-timeout-handled"\)\n      else if isHbTimer then/,
    '      if isHbTimer then',
  );
  // Reviewed output-diagnostic bodies are separately hash-pinned by the
  // package gate; exclude only these named reporting subs from boot comparison.
  for (const name of ['LogActiveDisplayModes', 'WriteOutputDiagFile', 'PostJsToWidget']) {
    const block = new RegExp(`Sub ${name}\\([^]*?\\nEnd Sub`);
    stripped = stripped.replace(block, baseline.match(block)[0]);
  }
  // Candidate 1.5.42 pins this complete source file by hash and separately
  // proves that initialized widgets use BrightSign's documented constructor
  // port only, with no second SetPort and no boot-sensitive operation.
  if (source.includes('BRIDGE|WIDGET_PORT|attach=constructor-only|nodejs=1')) {
    const block = /Function TryCreateHtmlWidget\([^]*?\nEnd Function/;
    const expectedWidget = baseline.match(block)[0]
      .replace('  cfg.url = url\n  cfg.port = msgPort\n',
        '  cfg.url = url\n' +
        "  ' BrightSign roHtmlWidget contract: when initialization properties are used,\n" +
        "  ' supply port here instead of calling SetPort() after construction.\n" +
        '  cfg.port = msgPort\n')
      .replace('    AttachHtmlWidgetPort(html, msgPort)\n    SafePrint("=== Perform6: HtmlWidget modern config OK (nodejs) ===")',
        '    LedLog("BRIDGE|WIDGET_PORT|attach=constructor-only|nodejs=1")\n' +
        '    SafePrint("=== Perform6: HtmlWidget modern config OK (nodejs; constructor port only) ===")')
      .replace('    AttachHtmlWidgetPort(html, msgPort)\n    SafePrint("=== Perform6: HtmlWidget minimal config OK ===")',
        '    SafePrint("=== Perform6: HtmlWidget minimal config OK (constructor port only) ===")')
      .replace('    AttachHtmlWidgetPort(html, msgPort)\n    SafePrint("=== Perform6: HtmlWidget url+port config OK ===")',
        '    SafePrint("=== Perform6: HtmlWidget url+port config OK (constructor port only) ===")');
    assert.equal(source.match(block)[0], expectedWidget,
      'widget change must contain only the three reviewed line edits');
    stripped = stripped.replace(block, baseline.match(block)[0]);
  }
  stripped = stripped.replace(/Function DiagnosticModeIs60p\([^]*?\nEnd Function\n\n/, '');
  assert.equal(stripped.trimEnd(), baseline.trimEnd());
});

test('XT output diagnostics use screen mode, not canvas FPS, without changing output', () => {
  const writer = source.match(/Sub WriteOutputDiagFile\([^]*?\nEnd Sub/)[0];
  assert.match(writer, /if DiagnosticModeIs60p\(ledModeText, "3840x2160"\) then ok = "1"/);
  assert.doesNotMatch(writer, /fps >=|fps <=/);
  const reporter = source.match(/Sub LogActiveDisplayModes\([^]*?\nEnd Sub/)[0];
  assert.match(reporter, /GetConfiguredScreenMode\(vm, "HDMI-1"\)/);
  assert.match(reporter, /if profile = "XT2145" then\s+LedLog\("OUT\|CANVAS\|reportedFps=/);
  assert.match(reporter, /HDMI-1 configured mode unexpected or unavailable/);
  assert.doesNotMatch(reporter, /\.Set\w*\(|RebootDevice|PlayFile|EncryptStorage/);
});

test('active addition is a constructor-only capability probe', () => {
  const active = source.split(marker)[0];
  assert.equal((active.match(/P6LabProbeCryptoSupport\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(active, /P6LabReadPlaybackKey|P6LabPlayEncryptedAsset/);
});

test('only reviewed capability files differ from 1.5.23 runtime', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'c7011b5', '--', 'src', 'brightsign'], { encoding: 'utf8' }).trim().split('\n').sort();
  const expected = ['brightsign/autorun.brs', 'src/services/autorunCapabilities.ts'];
  if (source.includes('MEDIA|PROBE|disabled|registry=')) expected.push('src/services/autorunDiag.ts');
  if (source.includes('BRIDGE|POST_JS|hello-ack|accepted=')) expected.push('src/platform/bsMessagePort.ts');
  if (source.includes('HandleP6MediaKeyProbe(payload)')) expected.push('src/contexts/RuntimeContext.tsx');
  if (source.includes('HandleP6MediaKeyProbe(payload)')) expected.push('src/services/otaAssetPool.ts');
  assert.deepEqual(changed, expected.sort());
});

test('probe and dormant helpers cannot mutate storage or start playback', () => {
  const helper = source.split(marker)[1];
  const probe = helper.slice(0, helper.indexOf('Function P6LabIsHex32'));
  assert.match(probe, /CreateObject\("roRegistrySection", "perform6_media_keys"\)/);
  assert.match(probe, /CreateObject\("roByteArray"\)/);
  assert.doesNotMatch(probe, /\.\s*(?:Read|Write|Flush|Delete)\s*\(/i);
  assert.doesNotMatch(probe, /PlayFile|reboot|encryptstorage|format/i);

  const handlerAt = helper.indexOf("' Post-health, version-scoped key-store interoperability probe.");
  const dormantReader = helper.slice(
    helper.indexOf('Function P6LabIsHex32'),
    handlerAt > 0 ? handlerAt : undefined,
  );
  assert.doesNotMatch(dormantReader, /\.\s*(?:Write|Flush|Delete)\s*\(/i);
  assert.doesNotMatch(dormantReader, /PlayFile|reboot|encryptstorage|format/i);
});
