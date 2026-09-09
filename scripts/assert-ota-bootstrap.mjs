import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const bootstrapPath = path.join(root, 'ops', 'perform6-ota-bootstrap-1.5.12.html');
const releaseRoot = path.join(
  root,
  'releases',
  'xt2145',
  'perform6-xt2145-1.5.12',
);

const html = fs.readFileSync(bootstrapPath, 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!match) throw new Error('Bootstrap script block not found');

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'perform6-ota-bootstrap-'));
const stageRoot = path.join(sandboxRoot, 'perform6-ota-stage', '1.5.12');
fs.mkdirSync(stageRoot, { recursive: true });

function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : [rel];
  });
}

const releaseFiles = walk(releaseRoot);
for (const rel of releaseFiles) {
  const staged = path.join(stageRoot, rel.replaceAll('/', '--'));
  fs.copyFileSync(path.join(releaseRoot, rel), staged);
  const active = path.join(sandboxRoot, rel);
  fs.mkdirSync(path.dirname(active), { recursive: true });
  fs.writeFileSync(active, `old:${rel}`);
}

let rebooted = false;
const statusElement = { textContent: '' };
class SystemMock {
  reboot() {
    rebooted = true;
  }
}

const script = match[1].replaceAll('/storage/sd', sandboxRoot.replaceAll('\\', '/'));
const context = {
  console,
  Date,
  JSON,
  String,
  Error,
  setTimeout: () => 1,
  document: { getElementById: () => statusElement },
  window: {
    require(id) {
      if (id === 'fs') return fs;
      if (id === 'crypto') return crypto;
      if (id === '@brightsign/system') return SystemMock;
      throw new Error(`Unexpected module ${id}`);
    },
    location: { replace() {} },
  },
};
vm.runInNewContext(script, context, { filename: bootstrapPath });

if (!rebooted) throw new Error('Bootstrap did not request reboot');
for (const rel of releaseFiles) {
  const actual = fs.readFileSync(path.join(sandboxRoot, rel));
  const expected = fs.readFileSync(path.join(releaseRoot, rel));
  if (!actual.equals(expected)) throw new Error(`Activated bytes differ: ${rel}`);
  const backup = path.join(
    sandboxRoot,
    'perform6-recovery',
    '1.5.11-to-1.5.12',
    rel,
  );
  if (fs.readFileSync(backup, 'utf8') !== `old:${rel}`) {
    throw new Error(`Backup bytes differ: ${rel}`);
  }
}

const status = JSON.parse(
  fs.readFileSync(path.join(sandboxRoot, 'perform6-ota-bootstrap-status.json'), 'utf8'),
);
if (status.state !== 'REBOOTING' || status.activated.length !== releaseFiles.length) {
  throw new Error(`Unexpected bootstrap status: ${JSON.stringify(status)}`);
}

fs.rmSync(sandboxRoot, { recursive: true, force: true });
console.log(`OTA bootstrap gate passed (${releaseFiles.length} files, backup + activation + reboot).`);
