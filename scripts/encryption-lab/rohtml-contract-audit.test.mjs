import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const autorun = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const bridge = fs.readFileSync('src/platform/bsMessagePort.ts', 'utf8');
const diag = fs.readFileSync('src/services/autorunDiag.ts', 'utf8');

const widgetFactory = autorun.match(
  /Function TryCreateHtmlWidget\([^]*?\nEnd Function/,
)?.[0];

test('modern roHtmlWidget uses one documented initialization port', () => {
  assert.ok(widgetFactory, 'widget factory missing');
  const modern = widgetFactory.match(
    /cfg = CreateObject\("roAssociativeArray"\)[^]*?return html/,
  )?.[0];
  assert.ok(modern, 'modern constructor path missing');
  for (const required of [
    'cfg.url = url',
    'cfg.port = msgPort',
    'cfg.mouse_enabled = true',
    'cfg.brightsign_js_objects_enabled = true',
    'cfg.javascript_enabled = true',
    'cfg.nodejs_enabled = true',
    'CreateObject("roHtmlWidget", rect, cfg)',
  ]) assert.match(modern, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((modern.match(/cfg\.port\s*=\s*msgPort/g) ?? []).length, 1);
  const executable = modern.replace(/'.*$/gm, '');
  assert.doesNotMatch(executable, /SetPort|SetUrl|\.Show\(|Reboot|Encrypt|Format/);
});

test('classic fallback alone uses SetPort before SetUrl', () => {
  assert.ok(widgetFactory);
  const classic = widgetFactory.slice(widgetFactory.indexOf('html = CreateObject("roHtmlWidget", rect)'));
  assert.ok(classic.indexOf('AttachHtmlWidgetPort(html, msgPort)') >= 0);
  assert.ok(classic.indexOf('AttachHtmlWidgetPort(html, msgPort)') < classic.indexOf('html.SetUrl(url)'));
});

test('packaged local HTML paths use supported file URI forms', () => {
  assert.match(autorun, /BuildAppUrl\("file:\/\/\/SD:\/index\.html"/);
  assert.match(autorun, /BuildAppUrl\("file:\/\/\/index\.html"/);
  assert.doesNotMatch(autorun, /BuildAppUrl\("(?:SD:|\/storage\/sd\/)/);
});

test('JavaScript constructs exactly one field-proven port', () => {
  assert.equal((bridge.match(/new ctor\(\)/g) ?? []).length, 0);
  assert.equal((bridge.match(/new NodeCtor\(\)/g) ?? []).length, 1);
  assert.equal((bridge.match(/new DomCtor\(\)/g) ?? []).length, 1);
  assert.match(bridge, /const port = new NodeCtor\(\)/);
  assert.doesNotMatch(bridge, /inboundObserverPort|node-outbound\+dom-receiver/);
  assert.match(bridge, /port\.addEventListener\('bsmessage', onMsg\)/);
  assert.match(bridge, /\.onbsmessage\s*=\s*\n?\s*onMsg/);
  assert.match(bridge, /transport === 'dom-bsmessageport'/);
  assert.match(bridge, /transport === 'node-messageport'/);
  assert.doesNotMatch(diag, /new\s+(?:Ctor|MessagePort|NodeCtor)\s*\(/);
});

test('hello acknowledgement remains flat and carries no key material', () => {
  const hello = autorun.match(/Sub HandleLedHello\([^]*?\nEnd Sub/)?.[0];
  assert.ok(hello, 'hello handler missing');
  assert.doesNotMatch(hello, /msg\.[A-Za-z0-9_]+\s*=\s*CreateObject/);
  assert.doesNotMatch(hello, /EncryptionKey|privateKey|wrappedKey|keyHex|ivHex/);
  assert.match(hello, /PostJsMessage\(html, msg\)/);
});

test('Node reload hazard is isolated to explicit error recovery, not normal boot', () => {
  const xtBoot = autorun.match(
    /if profile = "XT2145" and multiOutput then[^]*?else if profile = "XC4055"/,
  )?.[0];
  assert.ok(xtBoot, 'XT boot branch missing');
  assert.doesNotMatch(xtBoot, /\.SetUrl\(/);
  assert.match(autorun, /if reason = "load-error" then[^]*?htmlTouch\.SetUrl\(touchUrl\)/);
});
