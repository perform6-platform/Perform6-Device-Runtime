import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const modern = source.match(/cfg = CreateObject\("roAssociativeArray"\)[\s\S]*?if type\(html\) = "roHtmlWidget" then[\s\S]*?return html/);

test('modern Node widget uses the documented constructor-only message port', () => {
  assert.ok(modern, 'modern widget block missing');
  assert.equal((modern[0].match(/cfg\.port\s*=\s*msgPort/g) || []).length, 1);
  assert.doesNotMatch(modern[0], /AttachHtmlWidgetPort\(html, msgPort\)/);
  assert.doesNotMatch(modern[0], /html\.SetPort\(msgPort\)/);
  assert.match(modern[0], /BRIDGE\|WIDGET_PORT\|attach=constructor-only\|nodejs=1/);
});

test('port attachment remains before Show and no boot-sensitive behavior was introduced', () => {
  const createIndex = source.indexOf('htmlTouch = TryCreateHtmlWidget');
  const showIndex = source.indexOf('htmlTouch.Show()', createIndex);
  assert.ok(createIndex >= 0 && showIndex > createIndex);
  assert.doesNotMatch(modern[0], /Reboot|EncryptStorage|Format|DeleteFile|SetUrl/);
});
