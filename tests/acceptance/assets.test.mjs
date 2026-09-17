import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../../packages/core/dist/index.js';
import { readDocumentAsset, resolveDocumentAssets, sniffImage } from '../../packages/file-store/dist/index.js';

const fixtures = fileURLToPath(new URL('../fixtures/assets/', import.meta.url));
const docWith = srcs => parseDocument('# D {#d}\n\n' + srcs.map((src, i) => `@figure id="fig-${i}" src=${JSON.stringify(src)} alt="a"`).join('\n\n') + '\n');
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'naru-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets'));
  for (const name of ['pixel.png', 'pixel.jpg', 'pixel.webp']) await copyFile(join(fixtures, name), join(dir, 'assets', name));
  return { dir, file: join(dir, 'doc.narudoc') };
}
const codes = report => report.diagnostics.map(d => d.code);

test('valid PNG, JPEG and WebP assets resolve with detected type and dimensions, read-only', async t => {
  const { dir, file } = await setup(t);
  const before = await stat(join(dir, 'assets', 'pixel.png'));
  const report = await resolveDocumentAssets(file, docWith(['assets/pixel.png', 'assets/pixel.jpg', 'assets/pixel.webp', 'assets/pixel.png']));
  assert.deepEqual(codes(report), []);
  assert.deepEqual([...report.assets.values()].map(a => [a.mediaType, a.width, a.height]), [['image/png', 1, 1], ['image/jpeg', 1, 1], ['image/webp', 1, 1]]);
  assert.equal(report.assets.size, 3, 'shared src resolves once');
  const after = await stat(join(dir, 'assets', 'pixel.png'));
  assert.equal(after.mtimeMs, before.mtimeMs);
  const served = await readDocumentAsset(file, 'assets/pixel.webp');
  assert.equal(served.mediaType, 'image/webp');
  assert.deepEqual(served.bytes, await readFile(join(fixtures, 'pixel.webp')));
});
test('path escapes, absolute, drive, UNC, backslash, dot segments and unsupported types are rejected', async t => {
  const { file } = await setup(t);
  const outside = join(fixtures, 'pixel.png');
  const cases = [
    ['../escape.png', 'NARU_ASSET_PATH'],
    ['assets/../assets/pixel.png', 'NARU_ASSET_PATH'],
    ['assets//pixel.png', 'NARU_ASSET_PATH'],
    ['./assets/pixel.png', 'NARU_ASSET_PATH'],
    ['/absolute.png', 'NARU_ASSET_PATH'],
    ['C:/escape.png', 'NARU_ASSET_PATH'],
    ['c:\\escape.png', 'NARU_ASSET_PATH'],
    ['\\\\server\\share\\x.png', 'NARU_ASSET_PATH'],
    ['assets\\pixel.png', 'NARU_ASSET_PATH'],
    ['assets/pixel.png/', 'NARU_ASSET_PATH'],
    [outside.replaceAll('\\', '/'), 'NARU_ASSET_PATH'],
    ['https://example.com/x.png', 'NARU_ASSET_PATH'],
    ['data:image/png;base64,xx', 'NARU_ASSET_PATH'],
    ['assets/vector.svg', 'NARU_ASSET_PATH'],
    ['assets/pixel.PNG'.replace('PNG', 'gif'), 'NARU_ASSET_PATH'],
    ['assets/', 'NARU_ASSET_PATH'],
  ];
  for (const [src, code] of cases) assert.deepEqual(codes(await resolveDocumentAssets(file, docWith([src]))), [code], src);
});
test('spaces, Hangul, hash and percent names resolve as literal path segments', async t => {
  const { dir, file } = await setup(t);
  await copyFile(join(fixtures, 'pixel.png'), join(dir, 'assets', '제어 #1 100%.png'));
  const report = await resolveDocumentAssets(file, docWith(['assets/제어 #1 100%.png']));
  assert.deepEqual(codes(report), []);
  assert.equal(report.assets.get('assets/제어 #1 100%.png').mediaType, 'image/png');
});
test('missing files, directories, content mismatch, disguised HTML and truncation fail closed', async t => {
  const { dir, file } = await setup(t);
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/missing.png']))), ['NARU_ASSET_MISSING']);
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets']))), ['NARU_ASSET_PATH']);
  await copyFile(join(fixtures, 'pixel.png'), join(dir, 'assets', 'wrong.jpg'));
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/wrong.jpg']))), ['NARU_ASSET_TYPE'], 'extension must match sniffed content');
  await writeFile(join(dir, 'assets', 'fake.png'), '<script>alert(1)</script>');
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/fake.png']))), ['NARU_ASSET_TYPE'], 'HTML in image clothing');
  const truncated = (await readFile(join(fixtures, 'pixel.png'))).subarray(0, 20);
  await writeFile(join(dir, 'assets', 'cut.png'), truncated);
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/cut.png']))), ['NARU_ASSET_TYPE'], 'truncated image');
});
test('file symlinks are rejected conservatively', async t => {
  const { dir, file } = await setup(t);
  const outside = await mkdtemp(join(tmpdir(), 'naru-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await copyFile(join(fixtures, 'pixel.png'), join(outside, 'escape.png'));
  try {
    await symlink(join(outside, 'escape.png'), join(dir, 'assets', 'link.png'));
  } catch (error) {
    t.skip(`symlink unavailable in this environment: ${error.code}`); // skip is not link-safety evidence
    return;
  }
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/link.png']))), ['NARU_ASSET_LINK']);
});
test('directory junctions never reach outside targets and hardlinks are rejected', async t => {
  const { dir, file } = await setup(t);
  const outside = await mkdtemp(join(tmpdir(), 'naru-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await copyFile(join(fixtures, 'pixel.png'), join(outside, 'escape.png'));
  try {
    await symlink(outside, join(dir, 'assets', 'dirlink'), 'junction');
    const viaDir = await resolveDocumentAssets(file, docWith(['assets/dirlink/escape.png']));
    assert.deepEqual(codes(viaDir), ['NARU_ASSET_LINK'], 'directory links never reach the target');
  } catch (error) {
    t.diagnostic(`junction unavailable here (${error.code}); symlink test covers the same lstat rejection`);
  }
  await link(join(dir, 'assets', 'pixel.png'), join(dir, 'assets', 'hard.png'));
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/hard.png']))), ['NARU_ASSET_LINK'], 'hardlink');
});
test('per-file, total, count and dimension limits are enforced', async t => {
  const { file } = await setup(t);
  const small = { maxBytes: 4, maxTotalBytes: 1024, maxCount: 100, maxDimension: 16384 };
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/pixel.png']), small)), ['NARU_ASSET_LIMIT']);
  const tight = { maxBytes: 1024, maxTotalBytes: 550, maxCount: 100, maxDimension: 16384 };
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/pixel.jpg', 'assets/pixel.png']), tight)), ['NARU_ASSET_LIMIT'], 'jpg (516) + png (69) exceeds 550 total');
  const few = { maxBytes: 1024, maxTotalBytes: 4096, maxCount: 1, maxDimension: 16384 };
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/pixel.png', 'assets/pixel.jpg']), few)), ['NARU_ASSET_LIMIT']);
  const tiny = { maxBytes: 1024, maxTotalBytes: 4096, maxCount: 100, maxDimension: 0 };
  assert.deepEqual(codes(await resolveDocumentAssets(file, docWith(['assets/pixel.png']), tiny)), ['NARU_ASSET_LIMIT']);
});
test('sniffer rejects empty, random and signature-only bytes', () => {
  assert.equal(sniffImage(Buffer.alloc(0)), undefined);
  assert.equal(sniffImage(Buffer.from('not an image at all, really')), undefined);
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), undefined, 'PNG signature alone');
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), undefined, 'JPEG header without SOF/EOI');
  assert.equal(sniffImage(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'))?.mediaType, 'image/webp');
});
