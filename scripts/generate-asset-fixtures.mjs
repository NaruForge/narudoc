// Generates tiny valid PNG/JPEG/WebP fixtures for asset tests and the public example.
// Run: node scripts/generate-asset-fixtures.mjs
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (1 + width * 3) + 1 + x * 3;
    raw[at] = rgb[0]; raw[at + 1] = rgb[1]; raw[at + 2] = rgb[2];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Public-domain style minimal 1x1 JPEG and lossless 1x1 WebP, kept as base64 constants.
export const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAc//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ISf/2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z',
  'base64');
export const WEBP_1X1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

const targets = [
  ['examples/assets/control.png', png(8, 8, [32, 96, 160])],
  ['examples/assets/control-revised.png', png(8, 8, [160, 96, 32])],
  ['tests/fixtures/assets/pixel.png', png(1, 1, [200, 40, 40])],
  ['tests/fixtures/assets/pixel.jpg', JPEG_1X1],
  ['tests/fixtures/assets/pixel.webp', WEBP_1X1],
];
for (const [relative, bytes] of targets) {
  const path = join(root, relative);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, bytes);
  console.log(relative, bytes.length, 'bytes');
}
