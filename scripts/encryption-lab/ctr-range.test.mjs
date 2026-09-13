import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LOOPBACK_HOST,
  counterForOffset,
  createCtrRangeStream,
  createEncryptedMediaHandler,
  parseSingleRange,
} from './ctr-range.mjs';

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('CTR counter advances by the complete AES blocks preceding an offset', () => {
  const iv = Buffer.from('000000000000000000000000000000fe', 'hex');
  assert.equal(counterForOffset(iv, 0).toString('hex'), iv.toString('hex'));
  assert.equal(counterForOffset(iv, 32).toString('hex'), '00000000000000000000000000000100');
});

test('single HTTP byte ranges are parsed and invalid or multipart ranges fail closed', () => {
  assert.deepEqual(parseSingleRange(undefined, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(parseSingleRange('bytes=7-19', 100), { start: 7, end: 19, partial: true });
  assert.deepEqual(parseSingleRange('bytes=90-', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(parseSingleRange('bytes=-8', 100), { start: 92, end: 99, partial: true });
  assert.equal(parseSingleRange('bytes=0-1,4-5', 100), null);
  assert.equal(parseSingleRange('bytes=100-', 100), null);
});

test('random aligned and unaligned ranges decrypt to the original bytes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perform6-ctr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plain = randomBytes(2 * 1024 * 1024 + 37);
  const key = randomBytes(16);
  const iv = randomBytes(16);
  const encrypted = Buffer.concat([
    createCipheriv('aes-128-ctr', key, iv).update(plain),
  ]);
  const file = path.join(dir, 'asset.p6enc');
  fs.writeFileSync(file, encrypted);

  for (const [start, end] of [[0, 0], [1, 31], [15, 65570], [16, 31], [997, 99999], [plain.length - 91, plain.length - 1]]) {
    const actual = await collect(createCtrRangeStream({ path: file, key, iv, start, end }));
    assert.deepEqual(actual, plain.subarray(start, end + 1));
  }
});

test('HTTP handler serves correct decrypted ranges through a loopback-only listener', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perform6-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plain = randomBytes(256 * 1024 + 9);
  const key = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-ctr', key, iv);
  const file = path.join(dir, 'pilot.p6enc');
  fs.writeFileSync(file, Buffer.concat([cipher.update(plain), cipher.final()]));

  const handler = createEncryptedMediaHandler({
    resolveAsset: async (id) => id === 'pilot' ? { path: file } : null,
    getKeyMaterial: async (id) => id === 'pilot' ? { key, iv } : null,
  });
  const server = createServer(handler);
  server.listen(0, LOOPBACK_HOST);
  await once(server, 'listening');
  t.after(() => server.close());
  assert.equal(server.address().address, LOOPBACK_HOST);

  const result = await new Promise((resolve, reject) => {
    const req = request({
      host: LOOPBACK_HOST,
      port: server.address().port,
      path: '/media/pilot',
      headers: { Range: 'bytes=13-70000' },
    }, async (res) => resolve({ status: res.statusCode, headers: res.headers, body: await collect(res) }));
    req.on('error', reject);
    req.end();
  });
  assert.equal(result.status, 206);
  assert.equal(result.headers['content-range'], `bytes 13-70000/${plain.length}`);
  assert.deepEqual(result.body, plain.subarray(13, 70001));
});
