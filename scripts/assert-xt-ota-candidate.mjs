#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeBaseline = 'c7011b5';
const version = process.argv[2];
const packageFolder = process.argv[3]
  ? path.resolve(root, process.argv[3])
  : version
    ? path.join(root, 'releases', 'xt2145', `perform6-xt2145-${version}`)
    : '';
const zipPath = process.argv[4]
  ? path.resolve(root, process.argv[4])
  : version
    ? `${packageFolder}.zip`
    : '';

function fail(message) {
  console.error(`[xt-ota-safety] FAIL: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
  });
}

function sha256(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function listFiles(folder, relative = '') {
  const result = [];
  for (const name of fs.readdirSync(path.join(folder, relative)).sort()) {
    const rel = path.posix.join(relative, name);
    const absolute = path.join(folder, rel);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symbolic link is forbidden in OTA package: ${rel}`);
    if (stat.isDirectory()) result.push(...listFiles(folder, rel));
    else if (stat.isFile()) result.push(rel);
    else fail(`unsupported package entry: ${rel}`);
  }
  return result;
}

const brightScriptBuiltins = new Set(
  [
    'asc', 'chr', 'copyfile', 'createdirectory', 'createobject',
    'deletedirectory', 'deletefile', 'formatjson', 'getglobalaa', 'instr',
    'int', 'lcase', 'left', 'len', 'matchfiles', 'mid', 'movefile',
    'parsejson', 'readasciifile', 'right', 'sleep', 'str', 'stri', 'type',
    'ucase', 'val', 'wait', 'writeasciifile',
  ],
);

function unresolvedBrightScriptCalls(source) {
  const definitions = new Set(
    [...source.matchAll(/^\s*(?:Function|Sub)\s+([A-Za-z_]\w*)\s*\(/gim)]
      .map((match) => match[1].toLowerCase()),
  );
  const code = source
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/'.*$/gm, '');
  const calls = new Set();
  for (const match of code.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)) {
    calls.add(match[1]);
  }
  const keywords = new Set(['if', 'for', 'while', 'function', 'sub', 'return']);
  return [...calls]
    .filter((name) => {
      const lower = name.toLowerCase();
      return !definitions.has(lower) && !brightScriptBuiltins.has(lower) && !keywords.has(lower);
    })
    .sort();
}

if (!version || !packageFolder || !zipPath) {
  fail('usage: node scripts/assert-xt-ota-candidate.mjs <version> [package-folder] [zip]');
}
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`invalid semantic version: ${version}`);
if (version === '1.5.43') {
  fail('1.5.43 is quarantined: proposed message-port designs failed the pre-install safety audit');
}
if (!fs.existsSync(packageFolder)) fail(`package folder missing: ${packageFolder}`);
if (!fs.existsSync(zipPath)) fail(`package ZIP missing: ${zipPath}`);

try {
  execFileSync('git', ['merge-base', '--is-ancestor', safeBaseline, 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  fail(`HEAD is not descended from safe baseline ${safeBaseline}`);
}

// This clean-card release may change only the media-pool bootstrap. Startup,
// OTA, heartbeat, recovery, playback and UI control remain the field-proven
// 1.5.23 implementation.
// Version-specific reviewed dormant probe; never a blanket autorun exemption.
const reviewedProbeHashesByVersion = {
  '1.5.50': {
    'brightsign/autorun.brs': 'f898ac9ec1828c6e45350ab229d17a740fd744e361e5926df2f73f07a458adae',
    'src/platform/bsMessagePort.ts': 'f89c56c0df586b86e4f13fd1f00a8d88fd5fc625fdb9ecc9985ec336e029d44b',
    'src/platform/ledPlaybackFile.ts': '0b2c954d9ed398510b939da6c950d1db6b1a14483f0ca569d29a5db6f375824d',
    'src/platform/xtOutputBridge.ts': '77a13ff96c98d3ec80da534af31f53d864b230028304c664c2622cd8a331ee55',
    'src/services/autorunCapabilities.ts': '1b02ab696b1b49a0f94f0b6e2d4b1b465a6b5fc3d2105fbc7dd7b0905d39e998',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/services/bridgeKeepalive.ts': '75425ab1433feb1b0f3d74a2b5596ba18bf5974347c4fe33fce87f7520a6616c',
    'src/services/mediaEncryption.ts': 'f592b880a89986d8344e322ed8a9475abdd4587aec1f6f24cf36cdf4eec8ac1c',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
    'src/services/sync.ts': '2f1e8208b81bbe48575a5747b83d6f162c0b7d9830c7006319c1752cfcfe38b8',
    'src/services/syncEngine.ts': 'e376031b90d5c008864b2994e0425dfa56d2a7fa15baa916602452e7ac120b6d',
    'src/shared/types/api.ts': 'c04ebb8863456aab1ea0e573940bd4319cac0e6850db9b1ac7bc1a9e5b9148c5',
  },
  '1.5.49': {
    'brightsign/autorun.brs': '390e9c0991956f7c5e36589461f8e53ec61a85111493aa47c9cc553a1ce79662',
    'src/platform/bsMessagePort.ts': 'f89c56c0df586b86e4f13fd1f00a8d88fd5fc625fdb9ecc9985ec336e029d44b',
    'src/platform/ledPlaybackFile.ts': '0b2c954d9ed398510b939da6c950d1db6b1a14483f0ca569d29a5db6f375824d',
    'src/platform/xtOutputBridge.ts': '77a13ff96c98d3ec80da534af31f53d864b230028304c664c2622cd8a331ee55',
    'src/services/autorunCapabilities.ts': '1b02ab696b1b49a0f94f0b6e2d4b1b465a6b5fc3d2105fbc7dd7b0905d39e998',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/services/bridgeKeepalive.ts': '75425ab1433feb1b0f3d74a2b5596ba18bf5974347c4fe33fce87f7520a6616c',
    'src/services/mediaEncryption.ts': 'f592b880a89986d8344e322ed8a9475abdd4587aec1f6f24cf36cdf4eec8ac1c',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
    'src/services/sync.ts': '2f1e8208b81bbe48575a5747b83d6f162c0b7d9830c7006319c1752cfcfe38b8',
    'src/services/syncEngine.ts': 'e376031b90d5c008864b2994e0425dfa56d2a7fa15baa916602452e7ac120b6d',
    'src/shared/types/api.ts': 'c04ebb8863456aab1ea0e573940bd4319cac0e6850db9b1ac7bc1a9e5b9148c5',
  },
  '1.5.48': {
    'brightsign/autorun.brs': '8da4309d521998404b9689ae272988b905d9dc8a4d5e7b45bf44cdf8c6bb8e13',
    'src/platform/bsMessagePort.ts': 'f89c56c0df586b86e4f13fd1f00a8d88fd5fc625fdb9ecc9985ec336e029d44b',
    'src/platform/ledPlaybackFile.ts': '0b2c954d9ed398510b939da6c950d1db6b1a14483f0ca569d29a5db6f375824d',
    'src/platform/xtOutputBridge.ts': '77a13ff96c98d3ec80da534af31f53d864b230028304c664c2622cd8a331ee55',
    'src/services/autorunCapabilities.ts': '3a8120f1e6665ed7cefd2a73e13fa77dd9b25e8272ea08aea30f7b8f0167ad1e',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/services/bridgeKeepalive.ts': '75425ab1433feb1b0f3d74a2b5596ba18bf5974347c4fe33fce87f7520a6616c',
    'src/services/mediaEncryption.ts': 'f592b880a89986d8344e322ed8a9475abdd4587aec1f6f24cf36cdf4eec8ac1c',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
    'src/services/sync.ts': '2f1e8208b81bbe48575a5747b83d6f162c0b7d9830c7006319c1752cfcfe38b8',
    'src/services/syncEngine.ts': 'e376031b90d5c008864b2994e0425dfa56d2a7fa15baa916602452e7ac120b6d',
    'src/shared/types/api.ts': 'c04ebb8863456aab1ea0e573940bd4319cac0e6850db9b1ac7bc1a9e5b9148c5',
  },
  '1.5.47': {
    'brightsign/autorun.brs': '8da4309d521998404b9689ae272988b905d9dc8a4d5e7b45bf44cdf8c6bb8e13',
    'src/platform/bsMessagePort.ts': 'f89c56c0df586b86e4f13fd1f00a8d88fd5fc625fdb9ecc9985ec336e029d44b',
    'src/platform/ledPlaybackFile.ts': '0b2c954d9ed398510b939da6c950d1db6b1a14483f0ca569d29a5db6f375824d',
    'src/platform/xtOutputBridge.ts': 'd8d4ab87b697e10b02f76ffb810aaf493c8d674aac268e09cccef033b038000c',
    'src/services/autorunCapabilities.ts': '3a8120f1e6665ed7cefd2a73e13fa77dd9b25e8272ea08aea30f7b8f0167ad1e',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/services/bridgeKeepalive.ts': '75425ab1433feb1b0f3d74a2b5596ba18bf5974347c4fe33fce87f7520a6616c',
    'src/services/mediaEncryption.ts': 'f592b880a89986d8344e322ed8a9475abdd4587aec1f6f24cf36cdf4eec8ac1c',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
    'src/services/sync.ts': '2f1e8208b81bbe48575a5747b83d6f162c0b7d9830c7006319c1752cfcfe38b8',
    'src/services/syncEngine.ts': 'e376031b90d5c008864b2994e0425dfa56d2a7fa15baa916602452e7ac120b6d',
    'src/shared/types/api.ts': 'c04ebb8863456aab1ea0e573940bd4319cac0e6850db9b1ac7bc1a9e5b9148c5',
  },
  '1.5.46': {
    'brightsign/autorun.brs': 'dbb7a0b695373f4e8eba33b6cf4e486e6e831af6a20f3eb3b2b6e6b86872b475',
    'brightsign/encryption-test/perform6-encrypted-probe.p6enc': '63ecf15060f348f9d6dc5ebf391b6cdcd0a672a2b4233acb2d43597e6ceba7c7',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': 'de895c2ca5e410b7c65453acb1cb3109d4e7484b0905fc1ddde53ae98c6e578e',
    'src/contexts/RuntimeContext.tsx': '8ce3bd9b13795f2409c88da6355ed727af130a3c50755797985174f2d8053ba8',
    'src/services/mediaKeyInteropProbe.ts': '197263f9db72f163798efd358df3969096861f6553416eabbf4cd94944fc86e5',
    'src/services/encryptedPlaybackInteropProbe.ts': 'f31a513fbe8e1f02b440bb3ded8ff51c92c67997a35953639e75553678767ba3',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
  },
  '1.5.45': {
    'brightsign/autorun.brs': '9a65467777f8b87c363ba07539cae6c5c1f8c02a079732d5e2792f5b2fd6b6c8',
    'brightsign/encryption-test/perform6-encrypted-probe.p6enc': '63ecf15060f348f9d6dc5ebf391b6cdcd0a672a2b4233acb2d43597e6ceba7c7',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': 'de895c2ca5e410b7c65453acb1cb3109d4e7484b0905fc1ddde53ae98c6e578e',
    'src/contexts/RuntimeContext.tsx': 'aa540a2686e9196942f4699d9d4bc1ba344614106a8e76e76c24eef5db2ce0e3',
    'src/services/mediaKeyInteropProbe.ts': '197263f9db72f163798efd358df3969096861f6553416eabbf4cd94944fc86e5',
    'src/services/encryptedPlaybackInteropProbe.ts': '730ff2046c10c45fb924d09fabc0eebb9b2b3376cdd00e97a15f59056ccff5e0',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
  },
  '1.5.44': {
    'brightsign/autorun.brs': 'd6cf42737f1c5bac4c7c560f5fec01b848e61a00ea223df002f886567ca09925',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': 'de895c2ca5e410b7c65453acb1cb3109d4e7484b0905fc1ddde53ae98c6e578e',
    'src/contexts/RuntimeContext.tsx': '05bf98fa1191ad032f7f3adc08555ce53b9a081d916f43ad18025eb2dc523785',
    'src/services/mediaKeyInteropProbe.ts': '197263f9db72f163798efd358df3969096861f6553416eabbf4cd94944fc86e5',
    'src/services/otaAssetPool.ts': '00d541c4c50c5b7549446eb7615fa5b9abfc0d25f518c575b33ade262a410834',
  },
  '1.5.43': {
    'brightsign/autorun.brs': '194241b87b8e6bd83c887fd6d3185028c94be2c5f650884667ee4e110ca9882e',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': '9d976eae072ac7677c8bec1c230f6bb1cf0679a6900df829d319949200191d0c',
  },
  '1.5.42': {
    'brightsign/autorun.brs': '194241b87b8e6bd83c887fd6d3185028c94be2c5f650884667ee4e110ca9882e',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': '0b58864dacf00709d238569d1cf969bb9ae2be0d561d8a19a46cd582ff1adb34',
  },
  '1.5.41': {
    'brightsign/autorun.brs': '2d40d2fbb128ae14b9e85871052eb3c0add51df7305e95e593a2f0b8e9d0a9d3',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': '0b58864dacf00709d238569d1cf969bb9ae2be0d561d8a19a46cd582ff1adb34',
  },
  '1.5.40': {
    'brightsign/autorun.brs': 'fb9f8c736f4179e088da6a26f75aef2a1bf9cec1e03ce531b43f7a368ff0532a',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': '0b58864dacf00709d238569d1cf969bb9ae2be0d561d8a19a46cd582ff1adb34',
  },
  '1.5.39': {
    'brightsign/autorun.brs': 'fb9f8c736f4179e088da6a26f75aef2a1bf9cec1e03ce531b43f7a368ff0532a',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
    'src/platform/bsMessagePort.ts': '46c7e899d47cd6addf2591ae8b0d601eae1cbcb9105d4c742855460837afbf14',
  },
  '1.5.38': {
    'brightsign/autorun.brs': '692369fa51ed33a53fbea4e92e85864f5f99ba78e6c010807e3ccb50ef0aa306',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
    'src/services/autorunDiag.ts': '54db79cc9f8c156a9042b1c0422f4024772f4319852a6b0f7cff89891d609a27',
  },
  '1.5.36': {
    'brightsign/autorun.brs': '15a18cf7d16a1b03e1221a4666b96947e3808756f171aa4460ed4bb421b118d3',
    'src/services/autorunCapabilities.ts': '8a3de78f7be7077de6e8fd405b627b63a7bacd10d4fb9406c44db9419205e476',
  },
  '1.5.37': {
    'brightsign/autorun.brs': 'f5318ea1f2d9ba7f7a80107bda578a3ff21b334a74ea13bbeea8c1fbaaa68dbf',
    'src/services/autorunCapabilities.ts': '90659ef642585235750f9992ac03c6f2f0060d0bdcb5a802f6693da2e57ddf18',
  },
};
const reviewedProbeHashes = reviewedProbeHashesByVersion[version];
const dormantProbe = reviewedProbeHashes != null;
const allowedRuntimeDelta = new Set(dormantProbe ? Object.keys(reviewedProbeHashes) : [
  'src/services/assetPoolBootstrap.ts',
  'src/services/mediaAssetPool.ts',
]);
if (dormantProbe) {
  for (const [file, expected] of Object.entries(reviewedProbeHashes)) {
    if (sha256(fs.readFileSync(path.join(root, file))) !== expected) fail(`unreviewed dormant source: ${file}`);
  }
  if (version !== '1.5.47' && version !== '1.5.48' && version !== '1.5.49' && version !== '1.5.50') {
    execFileSync(
      process.execPath,
      ['--test', 'scripts/encryption-lab/dormant-integration.test.mjs'],
      { cwd: root, stdio: 'inherit' },
    );
  }
  if (version === '1.5.38') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/bridge-diagnostic.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.39' || version === '1.5.40' || version === '1.5.41' || version === '1.5.42' || version === '1.5.43') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/bridge-diagnostic.test.mjs', 'scripts/encryption-lab/bridge-observability.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.41') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/widget-port-binding.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.42') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/widget-port-binding.test.mjs', 'scripts/encryption-lab/rohtml-contract-audit.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.43') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/widget-port-binding.test.mjs', 'scripts/encryption-lab/rohtml-contract-audit.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.44') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/bridge-diagnostic.test.mjs', 'scripts/encryption-lab/bridge-observability.test.mjs', 'scripts/encryption-lab/widget-port-binding.test.mjs', 'scripts/encryption-lab/rohtml-contract-audit.test.mjs', 'scripts/encryption-lab/key-interop-candidate.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.44') execFileSync(process.execPath, ['--test', 'scripts/encryption-lab/ota-replacement.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.45') execFileSync(process.execPath, ['--test',
    'scripts/encryption-lab/bridge-diagnostic.test.mjs',
    'scripts/encryption-lab/bridge-observability.test.mjs',
    'scripts/encryption-lab/widget-port-binding.test.mjs',
    'scripts/encryption-lab/rohtml-contract-audit.test.mjs',
    'scripts/encryption-lab/key-interop-candidate.test.mjs',
    'scripts/encryption-lab/encrypted-playback-candidate.test.mjs',
    'scripts/encryption-lab/ota-replacement.test.mjs',
  ], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.46') execFileSync(process.execPath, ['--test',
    'scripts/encryption-lab/bridge-diagnostic.test.mjs',
    'scripts/encryption-lab/bridge-observability.test.mjs',
    'scripts/encryption-lab/widget-port-binding.test.mjs',
    'scripts/encryption-lab/rohtml-contract-audit.test.mjs',
    'scripts/encryption-lab/key-interop-candidate.test.mjs',
    'scripts/encryption-lab/encrypted-playback-candidate.test.mjs',
    'scripts/encryption-lab/ota-replacement.test.mjs',
  ], { cwd: root, stdio: 'inherit' });
  if (version === '1.5.47' || version === '1.5.48' || version === '1.5.49' || version === '1.5.50') execFileSync(
    process.execPath,
    ['--test', 'scripts/encryption-lab/production-media-encryption.test.mjs'],
    { cwd: root, stdio: 'inherit' },
  );
}
const trackedRuntime = git(['diff', '--name-only', safeBaseline, '--'])
  .trim().split(/\r?\n/).filter(Boolean);
const untrackedRuntime = git(['ls-files', '--others', '--exclude-standard', '--', 'src', 'brightsign'])
  .trim().split(/\r?\n/).filter(Boolean);
const historicalLabOnly = new Set([
  'brightsign/encryption-test/perform6-encrypted-probe.p6enc',
  'src/services/encryptedPlaybackInteropProbe.ts',
  'src/services/mediaKeyInteropProbe.ts',
]);
const changedRuntime = [...new Set([...trackedRuntime, ...untrackedRuntime])]
  .filter((file) => file.startsWith('src/') || file.startsWith('brightsign/'))
  .filter((file) => !(
    (version === '1.5.47' || version === '1.5.48' || version === '1.5.49' || version === '1.5.50') && historicalLabOnly.has(file)
  ));
for (const file of changedRuntime) {
  if (!allowedRuntimeDelta.has(file)) {
    fail(`unreviewed runtime delta relative to 1.5.23: ${file}`);
  }
}
for (const required of allowedRuntimeDelta) {
  if (!changedRuntime.includes(required)) fail(`expected reviewed runtime delta missing: ${required}`);
}

const sourceAutorun = fs.readFileSync(path.join(root, 'brightsign', 'autorun.brs'));
const baselineAutorun = git(['show', `${safeBaseline}:brightsign/autorun.brs`], {
  encoding: 'buffer',
});
if (!dormantProbe && !sourceAutorun.equals(baselineAutorun)) {
  fail('autorun.brs is not byte-identical to the field-proven 1.5.23 baseline');
}

const unresolved = unresolvedBrightScriptCalls(sourceAutorun.toString('utf8'));
if (unresolved.length) fail(`unresolved BrightScript call(s): ${unresolved.join(', ')}`);

// Prove the checker catches the real 1.5.33 outage rather than merely passing
// the current candidate. JsonEscape was called but never defined there.
const failedAutorun = fs.readFileSync(
  path.join(root, 'scripts', 'fixtures', 'autorun-1.5.33-undefined-jsonescape.brs'),
  'utf8',
);
const failedUnresolved = unresolvedBrightScriptCalls(failedAutorun);
if (!failedUnresolved.some((name) => name.toLowerCase() === 'jsonescape')) {
  fail('1.5.33 regression fixture did not detect unresolved JsonEscape');
}

const expectedFiles = new Set([
  'README-SD.txt',
  'assets/Inter-Bold-Sckx8rpT.woff2',
  'assets/Inter-Medium-D2bGa7uu.woff2',
  'assets/Inter-Regular-BOOGhInR.woff2',
  'assets/Inter-SemiBold-D273HNI0.woff2',
  'assets/Perform_6_trademark-ClFD9aGP.png',
  'assets/app.js',
  'assets/style.css',
  'autorun.brs',
  'index.html',
  'led-idle.png',
  'perform6-display.txt',
  'perform6-ops.emergency.json',
  'perform6-ops.json',
  'perform6-profile.txt',
  'perform6-release.json',
]);
if (version === '1.5.45' || version === '1.5.46') {
  expectedFiles.add('perform6-encryption-test/perform6-encrypted-probe.p6enc');
}
const folderFiles = listFiles(packageFolder);
for (const file of folderFiles) {
  if (!expectedFiles.has(file)) fail(`unexpected packaged file: ${file}`);
}
for (const file of expectedFiles) {
  if (!folderFiles.includes(file)) fail(`required packaged file missing: ${file}`);
}

const packageAutorun = fs.readFileSync(path.join(packageFolder, 'autorun.brs'));
if (!packageAutorun.equals(dormantProbe ? sourceAutorun : baselineAutorun)) {
  fail('packaged autorun differs from field-proven 1.5.23');
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(packageFolder, 'perform6-release.json'), 'utf8'),
);
if (manifest.profile !== 'XT2145' || manifest.version !== version) {
  fail(`manifest identity mismatch: ${manifest.profile ?? '?'} ${manifest.version ?? '?'}`);
}
if (manifest.storageEncryption?.enabled !== false) {
  fail('storage encryption must remain disabled for the clean-card pool test');
}
if (fs.readFileSync(path.join(packageFolder, 'perform6-profile.txt'), 'utf8').trim() !== 'XT2145') {
  fail('packaged hardware profile is not XT2145');
}

for (const [file, banned] of [
  ['autorun.brs', ['encryptstorage', 'formatstorage', 'formatfilesystem', 'jsonescape']],
  ['assets/app.js', ['encryptstorage', 'perform6-sd-encryption']],
]) {
  const body = fs.readFileSync(path.join(packageFolder, file), 'utf8').toLowerCase();
  for (const needle of banned) {
    if (body.includes(needle)) fail(`forbidden ${needle} present in packaged ${file}`);
  }
}

const ops = JSON.parse(fs.readFileSync(path.join(packageFolder, 'perform6-ops.json'), 'utf8'));
for (const unsafeFlag of ['clearCacheOnBoot', 'syncOnBoot', 'rebootAfterCacheClear']) {
  if (ops[unsafeFlag] === true) fail(`unsafe default operation enabled: ${unsafeFlag}`);
}
if (ops.pauseOta !== true) fail('pauseOta must default true so installation remains admin-triggered');

const zipRoot = `${path.basename(packageFolder)}/`;
const zipEntries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter((entry) => entry && !entry.endsWith('/'));
const normalizedZipFiles = zipEntries.map((entry) => {
  if (!entry.startsWith(zipRoot)) fail(`ZIP entry escapes expected package root: ${entry}`);
  const rel = entry.slice(zipRoot.length);
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) {
    fail(`unsafe ZIP path: ${entry}`);
  }
  return rel;
});
if (new Set(normalizedZipFiles).size !== normalizedZipFiles.length) {
  fail('ZIP contains duplicate file entries');
}
if (normalizedZipFiles.length !== folderFiles.length) fail('ZIP/folder file count mismatch');
for (const rel of folderFiles) {
  if (!normalizedZipFiles.includes(rel)) fail(`ZIP missing folder file: ${rel}`);
  const zipped = execFileSync('unzip', ['-p', zipPath, `${zipRoot}${rel}`]);
  const local = fs.readFileSync(path.join(packageFolder, rel));
  if (sha256(zipped) !== sha256(local)) fail(`ZIP content mismatch: ${rel}`);
}

console.log('[xt-ota-safety] PASS: packaged ZIP exactly matches the inspected folder');
console.log(dormantProbe
  ? '[xt-ota-safety] PASS: exact reviewed version-scoped candidate; all runtime deltas hash-pinned'
  : '[xt-ota-safety] PASS: autorun is byte-identical to field-proven 1.5.23');
console.log('[xt-ota-safety] PASS: unresolved BrightScript calls = 0');
console.log('[xt-ota-safety] PASS: historical 1.5.33 JsonEscape failure is detected');
console.log('[xt-ota-safety] PASS: full-card encryption, formatting, cache wipe, sync-on-boot and auto-OTA are disabled');
console.log(`[xt-ota-safety] candidate sha256=${sha256(fs.readFileSync(zipPath))}`);
