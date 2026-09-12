// Disposable synthetic video only. Tests AES-CTR bytes, NOT BrightSign playback.
// No runtime integration, real keys, media uploads, or filesystem writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function processOutput(command, args, input) {
  const r = spawnSync(command, args, { input, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, `${command} failed: ${r.error?.message ?? r.stderr?.toString()}`);
  return r.stdout;
}
const video = processOutput('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
  'color=c=blue:s=64x64:r=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
const key = randomBytes(16), iv = randomBytes(16);
function transform(bytes, selectedKey, decrypt = false) {
  const cipher = (decrypt ? createDecipheriv : createCipheriv)('aes-128-ctr', selectedKey, iv);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
const ciphertext = transform(video, key);
test('synthetic MP4 encrypted without changing byte count', () => {
  assert.equal(ciphertext.length, video.length);
  assert.notDeepEqual(ciphertext, video);
});
test('right key restores exact MP4 bytes and probe metadata', () => {
  const plain = transform(ciphertext, key, true);
  assert.deepEqual(plain, video);
  const profile = JSON.parse(processOutput('ffprobe', ['-v', 'error', '-i', 'pipe:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate', '-of', 'json'], plain));
  assert.equal(profile.streams[0].codec_name, 'h264');
  assert.equal(profile.streams[0].width, 64);
  assert.equal(profile.streams[0].r_frame_rate, '30/1');
});
test('ciphertext alone is not recognized as this MP4', () => {
  const result = spawnSync('ffprobe', ['-v', 'error', '-f', 'mov', '-i', 'pipe:0'], { input: ciphertext });
  assert.notEqual(result.status, 0);
});
test('wrong key does not reproduce original', () => {
  assert.notDeepEqual(transform(ciphertext, randomBytes(16), true), video);
});
test('CTR permits undetected tampering: separate integrity design required', () => {
  const changed = Buffer.from(ciphertext); changed[128] ^= 1;
  const plain = transform(changed, key, true);
  assert.equal(plain[128], video[128] ^ 1);
  // No authentication error is expected from CTR. Do not mistake roundtrip
  // success for a production authenticated media format.
});
