import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const baseline = execFileSync('git', ['show', '7d9dfad:brightsign/autorun.brs'], { encoding: 'utf8' });
const marker = "\n' Dormant helpers. No event or startup path invokes these in this candidate.\n";
test('existing autorun is byte-identical except informational hello fields', () => {
  const parts = source.split(marker);
  assert.equal(parts.length, 2);
  const stripped = parts[0].replace(
    '  \' Informational only; no registry access or encryption activation here.\n'
    + '  msg.AddReplace("encryptedMediaState", "disabled")\n'
    + '  msg.AddReplace("encryptedMediaActivation", "unavailable")\n', '');
  assert.equal(stripped.trimEnd(), baseline.trimEnd());
});
test('dormant helper has no caller in existing autorun', () => {
  const active = source.split(marker)[0];
  assert.equal(active.includes('P6Lab'), false);
});
test('shipped dormant reader matches independently inspected source', () => {
  const standalone = fs.readFileSync('scripts/encryption-lab/native-key-reader.brs', 'utf8');
  assert.equal(source.split(marker)[1].trim(), standalone.slice(standalone.indexOf('Function P6LabIsHex32')).trim());
});
test('native helper contains no writes, player invocation or recovery commands', () => {
  const helper = source.split(marker)[1];
  assert.doesNotMatch(helper, /\b(?:reboot|encryptstorage|formatdrive|writeasciifile|deletefile|movefile|copyfile|PlayFile|Main)\s*\(/i);
  assert.doesNotMatch(helper, /\.\s*(?:write|flush|delete)\s*\(/i);
});
