import { createDecipheriv } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { Transform } from 'node:stream';

const AES_BLOCK_BYTES = 16;
const MAX_COUNTER = 1n << 128n;

function requireBytes(value, bytes, label) {
  if (!Buffer.isBuffer(value) || value.length !== bytes) {
    throw new Error(`${label} must be ${bytes} bytes`);
  }
}

export function counterForOffset(iv, offset) {
  requireBytes(iv, AES_BLOCK_BYTES, 'iv');
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative safe integer');
  }
  const block = BigInt(Math.floor(offset / AES_BLOCK_BYTES));
  const initial = BigInt(`0x${iv.toString('hex')}`);
  const counter = (initial + block) % MAX_COUNTER;
  return Buffer.from(counter.toString(16).padStart(32, '0'), 'hex');
}

export function parseSingleRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('invalid media size');
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

export function createCtrRangeStream({ path, key, iv, start, end, highWaterMark = 256 * 1024 }) {
  requireBytes(key, AES_BLOCK_BYTES, 'key');
  requireBytes(iv, AES_BLOCK_BYTES, 'iv');
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new Error('invalid byte range');
  }

  const blockStart = start - (start % AES_BLOCK_BYTES);
  const discard = start - blockStart;
  const wanted = end - start + 1;
  const decipher = createDecipheriv('aes-128-ctr', key, counterForOffset(iv, blockStart));
  let skipped = 0;
  let emitted = 0;

  const trim = new Transform({
    transform(chunk, _encoding, callback) {
      let output = chunk;
      if (skipped < discard) {
        const consume = Math.min(discard - skipped, output.length);
        skipped += consume;
        output = output.subarray(consume);
      }
      if (output.length > 0 && emitted < wanted) {
        const remaining = wanted - emitted;
        output = output.subarray(0, remaining);
        emitted += output.length;
        this.push(output);
      }
      callback();
    },
  });

  return createReadStream(path, {
    start: blockStart,
    end,
    highWaterMark,
  }).pipe(decipher).pipe(trim);
}

export function createEncryptedMediaHandler({ resolveAsset, getKeyMaterial }) {
  return async function encryptedMediaHandler(request, response) {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const match = /^\/media\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
      if (!match) {
        response.writeHead(404);
        response.end();
        return;
      }
      const asset = await resolveAsset(match[1]);
      if (!asset || typeof asset.path !== 'string') {
        response.writeHead(404);
        response.end();
        return;
      }
      const material = await getKeyMaterial(match[1]);
      if (!material) {
        response.writeHead(503, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      const size = statSync(asset.path).size;
      const range = parseSingleRange(request.headers.range, size);
      if (!range) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` });
        response.end();
        return;
      }
      const length = range.end - range.start + 1;
      response.writeHead(range.partial ? 206 : 200, {
        'Accept-Ranges': 'bytes',
        'Content-Type': asset.contentType ?? 'video/mp4',
        'Content-Length': String(length),
        'Cache-Control': 'no-store',
        ...(range.partial
          ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }
          : {}),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createCtrRangeStream({
        path: asset.path,
        key: material.key,
        iv: material.iv,
        start: range.start,
        end: range.end,
      });
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' });
      response.end();
    }
  };
}

export const LOOPBACK_HOST = '127.0.0.1';
