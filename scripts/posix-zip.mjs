import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function walkFiles(folder) {
  const files = [];
  for (const name of fs.readdirSync(folder).sort()) {
    const absolute = path.join(folder, name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`symbolic link is forbidden in release ZIP: ${absolute}`);
    }
    if (stat.isDirectory()) files.push(...walkFiles(absolute));
    else if (stat.isFile()) files.push(absolute);
    else throw new Error(`unsupported release entry: ${absolute}`);
  }
  return files;
}

/**
 * Write a ZIP whose entry names always use `/`.
 * Windows Compress-Archive stores `\`, which macOS flattens into literal filenames.
 */
export function writePosixZip(packageFolder, zipPath) {
  const rootName = path.basename(packageFolder);
  const files = walkFiles(packageFolder);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const absolute of files) {
    const relative = path.relative(packageFolder, absolute).split(path.sep).join('/');
    if (relative.includes('\\') || relative.startsWith('/') || relative.split('/').includes('..')) {
      throw new Error(`unsafe package path: ${relative}`);
    }
    const entryName = `${rootName}/${relative}`;
    const data = fs.readFileSync(absolute);
    const compressed = zlib.deflateRawSync(data);
    const name = Buffer.from(entryName, 'utf8');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, end]));
}

export function listZipEntryNames(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`ZIP missing end of central directory: ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`ZIP central directory is truncated: ${zipPath}`);
    }
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    names.push(buf.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8'));
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function assertPosixZipPaths(zipPath) {
  const names = listZipEntryNames(zipPath);
  const bad = names.filter((name) => name.includes('\\'));
  if (bad.length > 0) {
    throw new Error(
      `ZIP contains Windows path separators (${bad.length}). First: ${bad[0]}`,
    );
  }
  return names;
}
