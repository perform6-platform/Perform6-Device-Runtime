import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync('brightsign/autorun.brs', 'utf8');
const baseline = execFileSync('git', ['show', 'c7011b5:brightsign/autorun.brs'], { encoding: 'utf8' });
const marker = "\n' Encryption remains disabled. Hello invokes only the read-only constructor\n";

test('only hello reporting and isolated helpers differ from 1.5.23 autorun', () => {
  const parts = source.split(marker);
  assert.equal(parts.length, 2);
  const stripped = parts[0].replace(
    /  ' Read-only capability probe\.[\s\S]*?  msg\.AddReplace\("encryptedMediaKeyContainer", cryptoProbe\.keyContainer\)\n/,
    '',
  );
  assert.equal(stripped.trimEnd(), baseline.trimEnd());
});

test('active addition is a constructor-only capability probe', () => {
  const active = source.split(marker)[0];
  assert.equal((active.match(/P6LabProbeCryptoSupport\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(active, /P6LabReadPlaybackKey|P6LabPlayEncryptedAsset/);
});

test('only reviewed capability files differ from 1.5.23 runtime', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'c7011b5', '--', 'src', 'brightsign'], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(changed, ['brightsign/autorun.brs', 'src/services/autorunCapabilities.ts']);
});

test('probe and dormant helpers cannot mutate storage or start playback', () => {
  const helper = source.split(marker)[1];
  const probe = helper.slice(0, helper.indexOf('Function P6LabIsHex32'));
  assert.match(probe, /CreateObject\("roRegistrySection", "perform6_media_keys"\)/);
  assert.match(probe, /CreateObject\("roByteArray"\)/);
  assert.doesNotMatch(probe, /\.\s*(?:Read|Write|Flush|Delete)\s*\(/i);
  assert.doesNotMatch(probe, /PlayFile|reboot|encryptstorage|format/i);

  const dormantReader = helper.slice(helper.indexOf('Function P6LabIsHex32'));
  assert.doesNotMatch(dormantReader, /\.\s*(?:Write|Flush|Delete)\s*\(/i);
  assert.doesNotMatch(dormantReader, /PlayFile|reboot|encryptstorage|format/i);
});
