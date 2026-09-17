import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseDocument, assertValid, planOperation, resolveReferences, referenceMetadata, validateDocument } from '../../packages/core/dist/index.js';
import { revision } from '../../packages/file-store/dist/index.js';

const cliPath = fileURLToPath(new URL('../../apps/cli/bin/narudoc.mjs', import.meta.url));
const cli = (args, input) => spawnSync(process.execPath, [cliPath, ...args], { input, encoding: 'utf8' });
const pixel = fileURLToPath(new URL('../fixtures/assets/pixel.png', import.meta.url));

test('figure annotation parses fields and source ranges in any attribute order', () => {
  const doc = parseDocument('# D {#d}\n\n@figure caption="Cap" alt="Alt text" src="assets/pixel.png" id="fig-a"\n');
  assertValid(doc);
  const figure = doc.blocks[1];
  assert.equal(figure.type, 'figure');
  assert.equal(figure.id, 'fig-a'); assert.equal(figure.src, 'assets/pixel.png');
  assert.equal(figure.alt, 'Alt text'); assert.equal(figure.caption, 'Cap');
  assert.equal(doc.source.slice(figure.idRange.start, figure.idRange.end), 'fig-a');
  assert.equal(doc.source.slice(figure.srcRange.start, figure.srcRange.end), '"assets/pixel.png"');
  assert.equal(doc.source.slice(figure.altRange.start, figure.altRange.end), '"Alt text"');
  assert.equal(doc.source.slice(figure.captionRange.start, figure.captionRange.end), '"Cap"');
  assert.equal(doc.source.slice(figure.captionAttributeRange.start, figure.captionAttributeRange.end), ' caption="Cap"');
  assert.equal(doc.source.slice(figure.range.start, figure.range.end), doc.blocks[1] && doc.source.split('\n')[2]);
});
test('malformed or out-of-section figure annotations are diagnosed, never rewritten', () => {
  const cases = [
    '@figure id="f" src="a.png"\n', // missing alt
    '@figure src="a.png" alt="a"\n', // missing id
    '@figure id="f" src="a.png" alt="a" extra="x"\n', // unknown key
    '@figure id="f" id="g" src="a.png" alt="a"\n', // duplicate key
    '@figure id="1bad" src="a.png" alt="a"\n', // invalid ID
    '@figure id="f" src="" alt="a"\n', // empty src
    '@figure\n', // no attributes
  ];
  for (const line of cases) {
    const doc = parseDocument(`# D {#d}\n\n${line}`);
    assert.equal(doc.blocks.length, 1, line);
    assert.ok(doc.diagnostics.some(d => d.code === 'NARU_FIGURE'), line);
  }
  const outside = parseDocument('@figure id="f" src="a.png" alt="a"\n\n# D {#d}\n');
  assert.ok(outside.diagnostics.some(d => d.code === 'NARU_FIGURE'));
  assert.equal(outside.blocks.filter(b => b.type === 'figure').length, 0);
  const literal = parseDocument('# D {#d}\n\n:::note\n\n@figure id="f" src="a.png" alt="a"\n\n:::\n\n```\n@figure id="g" src="b.png" alt="b"\n```\n');
  assertValid(literal);
  assert.equal(literal.blocks.filter(b => b.type === 'figure').length, 0, 'directive bodies and code keep literal text');
  const prefixed = parseDocument('# D {#d}\n\n@figurex id="f" src="a.png" alt="a"\n');
  assert.equal(prefixed.blocks[1].type, 'paragraph', 'the @figure boundary requires whitespace or end of line');
});
test('insertFigure writes one line and setFigureMetadata keeps ID, references and other bytes', () => {
  let doc = parseDocument('# D {#d}\n\nBody.\n');
  assert.throws(() => planOperation(doc, { type: 'insertFigure', sectionId: 'd', id: 'fig-a', src: '../escape.png', alt: 'x' }), { code: 'NARU_ARGUMENT' });
  assert.throws(() => planOperation(doc, { type: 'insertFigure', sectionId: 'd', id: 'fig-a', src: 'C:/x.png', alt: 'x' }), { code: 'NARU_ARGUMENT' });
  assert.throws(() => planOperation(doc, { type: 'insertFigure', sectionId: 'd', id: 'fig-a', src: 'assets/x.svg', alt: 'x' }), { code: 'NARU_ARGUMENT' });
  assert.throws(() => planOperation(doc, { type: 'insertFigure', sectionId: 'd', id: 'd', src: 'a.png', alt: 'x' }), { code: 'NARU_ARGUMENT' });
  doc = planOperation(doc, { type: 'insertFigure', sectionId: 'd', id: 'fig-a', src: 'assets/pixel.png', alt: '' }).next;
  assert.equal(doc.source, '# D {#d}\n\nBody.\n\n@figure id="fig-a" src="assets/pixel.png" alt=""\n');
  doc = planOperation(doc, { type: 'insertParagraph', id: 'd', index: 0, text: 'See [@fig-a].' }).next;
  const before = doc.source;
  const replaced = planOperation(doc, { type: 'setFigureMetadata', id: 'fig-a', src: 'assets/other.png' });
  assert.equal(replaced.next.source, before.replace('assets/pixel.png', 'assets/other.png'));
  assert.ok(replaced.next.source.includes('[@fig-a]'), 'src replacement keeps the ID and reference');
  const alt = planOperation(doc, { type: 'setFigureMetadata', id: 'fig-a', alt: 'Diagram' });
  assert.equal(alt.next.source, before.replace('alt=""', 'alt="Diagram"'));
  const captioned = planOperation(doc, { type: 'setFigureMetadata', id: 'fig-a', caption: 'Cap' });
  assert.equal(captioned.next.source, before.replace('alt=""', 'alt="" caption="Cap"'));
  const removed = planOperation(captioned.next, { type: 'setFigureMetadata', id: 'fig-a', caption: '' });
  assert.equal(removed.next.source, before);
  assert.deepEqual(planOperation(doc, { type: 'setFigureMetadata', id: 'fig-a', alt: '' }).edits, [], 'unchanged values are a no-op');
  assert.throws(() => planOperation(doc, { type: 'setFigureMetadata', id: 'fig-a' }), { code: 'NARU_ARGUMENT' });
  assert.throws(() => planOperation(doc, { type: 'setFigureMetadata', id: 'd', alt: 'x' }), { code: 'NARU_TARGET' });
  // One-character caption change patches one character range only.
  const one = planOperation(parseDocument('# D {#d}\n\n@figure id="f" src="a.png" alt="a" caption="bc"\n'), { type: 'setFigureMetadata', id: 'f', caption: 'bd' });
  assert.equal(one.edits.length, 1);
  assert.equal(one.edits[0].expected, 'c'); assert.equal(one.edits[0].text, 'd');
});
test('figure and table numbering stay separate and references reuse the common resolver', () => {
  const doc = parseDocument('# D {#d}\n\nSee [@fig-a] and [@tab-a].\n\n@figure id="fig-a" src="a.png" alt="a"\n\n@table id="tab-a"\n| X |\n| --- |\n\n@figure id="fig-b" src="b.png" alt="b" caption="Second"\n');
  assertValid(doc);
  const meta = referenceMetadata(doc);
  assert.deepEqual(meta.definitions.filter(d => d.kind !== 'heading').map(d => [d.id, d.label]), [['fig-a', 'Figure 1'], ['tab-a', 'Table 1'], ['fig-b', 'Figure 2']]);
  assert.deepEqual(meta.references.map(r => [r.targetId, r.label]), [['fig-a', 'Figure 1'], ['tab-a', 'Table 1']]);
  assert.equal(planOperation(doc, { type: 'insertReference', id: 'd', index: 0, path: '0', offset: 0, expected: 'See ', targetId: 'fig-b' }).next.source.includes('[@fig-b]See '), true);
  const renamed = planOperation(doc, { type: 'renameId', id: 'fig-a', newId: 'fig-main' }).next;
  assert.ok(renamed.source.includes('[@fig-main]') && renamed.source.includes('@figure id="fig-main"'));
  const headingRef = parseDocument('# D {#d}\n\nSee [@d].\n');
  assert.ok(validateDocument(headingRef).some(d => d.code === 'NARU_REFERENCE_KIND'), 'headings stay invalid semantic targets');
});
test('figure edits preserve BOM, CRLF and unrelated bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'naru-figure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets'));
  await copyFile(pixel, join(dir, 'assets', 'pixel.png'));
  const source = '﻿# 제어 {#control}\r\n\r\n@figure id="fig-main" src="assets/pixel.png" alt="제어 구성도 😀" caption="초기"\r\n';
  const file = join(dir, 'doc.narudoc');
  await writeFile(file, source);
  const one = cli(['figure', 'set', file, '--id', 'fig-main', '--caption', '수정', '--json']);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(await readFile(file), Buffer.from(source.replace('"초기"', '"수정"')));
  const noopRevision = JSON.parse(one.stdout).nextRevision;
  const noop = cli(['figure', 'set', file, '--id', 'fig-main', '--caption', '수정', '--revision', noopRevision, '--json']);
  assert.equal(noop.status, 0, noop.stderr);
  assert.equal(JSON.parse(noop.stdout).changed, false);
  assert.deepEqual(await readFile(file), Buffer.from(source.replace('"초기"', '"수정"')));
});
test('CLI figure insert/validate/render and asset failure keep files unchanged', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'naru-figure-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets'));
  await copyFile(pixel, join(dir, 'assets', 'pixel.png'));
  const file = join(dir, 'doc.narudoc');
  await writeFile(file, '# D {#d}\n');
  const insert = cli(['figure', 'insert', file, '--section', 'd', '--id', 'fig-a', '--src', 'assets/pixel.png', '--alt', 'Diagram', '--caption', 'Pixel', '--json']);
  assert.equal(insert.status, 0, insert.stderr);
  assert.equal(await readFile(file, 'utf8'), '# D {#d}\n\n@figure id="fig-a" src="assets/pixel.png" alt="Diagram" caption="Pixel"\n');
  assert.equal(cli(['validate', file, '--json']).status, 0);
  const render = cli(['render', file, '--to', 'html', '--json']);
  assert.equal(render.status, 0, render.stderr);
  const html = JSON.parse(render.stdout).html;
  assert.match(html, /<figure id="fig-a"><img src="assets\/pixel\.png" alt="Diagram"><figcaption>Figure 1: Pixel<\/figcaption><\/figure>/);
  // A missing asset blocks validate, saving and export without changing anything.
  const missing = cli(['figure', 'set', file, '--id', 'fig-a', '--src', 'assets/missing.png', '--json']);
  assert.equal(missing.status, 3, missing.stderr);
  assert.equal(JSON.parse(missing.stderr).error.code, 'NARU_ASSET');
  await writeFile(file, '# D {#d}\n\n@figure id="fig-a" src="assets/missing.png" alt="Diagram"\n');
  const before = await readFile(file);
  const validate = cli(['validate', file, '--json']);
  assert.equal(validate.status, 3);
  assert.ok(JSON.parse(validate.stdout).diagnostics.some(d => d.code === 'NARU_ASSET_MISSING'));
  assert.equal(cli(['render', file, '--to', 'html'], undefined).status, 3);
  const edit = cli(['paragraph', 'insert', file, '--id', 'd', '--index', '0', '--text', 'Text.', '--json']);
  assert.equal(edit.status, 3, 'normal saves require resolvable result assets');
  assert.deepEqual(await readFile(file), before);
  const recovery = cli(['figure', 'set', file, '--id', 'fig-a', '--src', 'assets/pixel.png', '--json']);
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(cli(['validate', file, '--json']).status, 0);
  assert.equal(cli(['render', file, '--to', 'html', '--json']).status, 0);
  assert.equal(revision(await readFile(file)), JSON.parse(recovery.stdout).nextRevision);
});
test('document and assets folder move together to a new absolute location', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'naru-move-a-'));
  const moved = await mkdtemp(join(tmpdir(), 'naru-move-b-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); await rm(moved, { recursive: true, force: true }); });
  await mkdir(join(dir, 'assets'));
  await copyFile(pixel, join(dir, 'assets', 'pixel.png'));
  const text = '# D {#d}\n\nSee [@fig-a].\n\n@figure id="fig-a" src="assets/pixel.png" alt="Diagram"\n';
  await writeFile(join(dir, 'doc.narudoc'), text);
  const before = cli(['render', join(dir, 'doc.narudoc'), '--to', 'html', '--json']);
  assert.equal(before.status, 0, before.stderr);
  // Move the whole folder; relative references must keep working untouched.
  const { rename } = await import('node:fs/promises');
  await rename(join(dir, 'doc.narudoc'), join(moved, 'doc.narudoc'));
  await rename(join(dir, 'assets'), join(moved, 'assets'));
  const after = cli(['render', join(moved, 'doc.narudoc'), '--to', 'html', '--json']);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(JSON.parse(after.stdout).html, JSON.parse(before.stdout).html);
  assert.equal(cli(['validate', join(moved, 'doc.narudoc'), '--json']).status, 0);
  assert.ok(!JSON.parse(after.stdout).html.includes(moved), 'export contains no absolute paths');
});
