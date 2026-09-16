import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { parseDocument, validateDocument, planOperation, planBatch, outline, getById } from '../../packages/core/dist/index.js';
import { renderHtml } from '../../packages/renderer-html/dist/index.js';

const fixture = await readFile(new URL('../../examples/directive-blocks.narudoc', import.meta.url), 'utf8');
test('issue 13 example has four children and code delimiters remain literal', () => {
  const doc = parseDocument(fixture);
  assert.deepEqual(validateDocument(doc), []);
  assert.deepEqual(doc.blocks.map(b => b.type), ['heading', 'directive']);
  const directive = doc.blocks[1];
  assert.equal('body' in directive, false);
  assert.deepEqual(directive.children.map(b => b.type), ['paragraph', 'list', 'code', 'paragraph']);
  assert.equal(directive.children[2].value, '[not a reference](#missing)\n:::\n:::not-a-nested-directive\n');
});

const wrap = body => `:::unknown\nid: D\n\n${body}\n:::`;
const slice = (source, range) => source.slice(range.start, range.end);
for (const body of ['', '  \n\t', 'single', 'first\n\nsecond']) test(`empty and paragraph body: ${JSON.stringify(body)}`, () => {
  const doc = parseDocument(wrap(body));
  assert.deepEqual(validateDocument(doc), []);
  assert.equal(doc.blocks[0].children.length, !body.trim() ? 0 : body === 'single' ? 1 : 2);
});
test('attribute-only directives, header insertion and following blocks', () => {
  for (const source of [':::custom\n:::', ':::custom\nid: D\n:::']) {
    assert.deepEqual(parseDocument(source).blocks[0].children, []);
  }
  const source = ':::custom\nid: D\n:::\n\nAfter';
  const plan = planOperation(parseDocument(source), { type: 'setDirectiveAttribute', id: 'D', key: 'status', value: 'draft' });
  assert.equal(plan.next.source, ':::custom\nid: D\nstatus: draft\n:::\n\nAfter');
  assert.deepEqual(plan.next.blocks.map(b => b.type), ['directive', 'paragraph']);
});

for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) test(`absolute block/link ranges ${JSON.stringify({eol, bom})}`, () => {
  const texts = ['First 😀 [one](#control)', '- [two](#%63ontrol)\n+ next', '3. third\n4) fourth', '~~~text\n[code](#missing)\n:::\n:::literal\n```\n~~~~', '# Literal {#ghost}\n---\nid: hidden\n---'];
  const source = bom + ('# 한글 😀 {#control}\n\n' + wrap(texts.join('\n\n')) + '\n\nAfter').replaceAll('\n', eol);
  const doc = parseDocument(source), children = doc.blocks[1].children;
  assert.deepEqual(validateDocument(doc), []);
  assert.deepEqual(children.map(b => b.type), ['paragraph', 'list', 'list', 'code', 'paragraph']);
  assert.deepEqual(children.map(b => slice(source, b.range)), texts.map(t => t.replaceAll('\n', eol)));
  assert.equal(children[2].start, 3);
  for (const link of [children[0].inline[1], children[1].items[0][0]]) assert.equal(slice(source, link.urlRange), link.url);
  assert.deepEqual(outline(doc).map(s => s.id), ['control']);
  assert.throws(() => getById(doc, 'ghost'), e => e.code === 'NARU_TARGET');
  assert.throws(() => getById(doc, 'hidden'), e => e.code === 'NARU_TARGET');
  assert.equal(doc.blocks.at(-1).type, 'paragraph');
});

test('delimiter, nested directive and unclosed fence diagnostics use original ranges', () => {
  const prefix = '\uFEFF# 한글 😀 {#a}\r\n\r\n';
  for (const tail of [':::x\r\n\r\n:::nested\r\n:::', ':::x\r\n:::nested\r\n:::']) {
    const source = prefix + tail, doc = parseDocument(source);
    assert.deepEqual(doc.diagnostics.map(d => [d.code, slice(source, d.range)]), [['NARU_DIRECTIVE_NESTED', ':::nested']]);
  }
  for (const fence of ['```', '~~~']) {
    const source = prefix + `:::x\r\n\r\n${fence}text\r\n:::`, doc = parseDocument(source);
    assert.deepEqual(doc.diagnostics.map(d => [d.code, slice(source, d.range)]), [
      ['NARU_FENCE', `${fence}text\r\n:::`], ['NARU_DIRECTIVE', source.slice(prefix.length)],
    ]);
  }
  const source = prefix + ':::x\r\n\r\nbody';
  assert.deepEqual(parseDocument(source).diagnostics.map(d => [d.code, slice(source, d.range)]), [['NARU_DIRECTIVE', ':::x\r\n\r\nbody']]);
});

test('broken and malformed fragments are checked once per child, code ignored', () => {
  const source = '# A {#a}\n\n' + wrap('[ok](#%61) [bad](#missing)\n\n- [bad](#%GG)\n\n```\n[ignored](#missing)\n```');
  const doc = parseDocument(source), children = doc.blocks[1].children;
  assert.deepEqual(validateDocument(doc).map(d => [d.code, d.range]), [
    ['NARU_REFERENCE', children[0].range], ['NARU_REFERENCE', children[1].range],
  ]);
});

// Expected destinations are explicit; unchanged labels, text, attributes and code
// deliberately keep the old ID rather than being derived by global replacement.
function editable(id = 'OLD', status = 'draft', direct = 'Outside', encoded = id === 'OLD' ? '%4fLD' : id) {
  return `# 한글 😀 {#${id}}\n\n:::custom\nid: D\nstatus: ${status}\nnote: [attribute](#OLD)\n\nOLD [OLD](#${id})\n\n- **[encoded](#${encoded})**\n- [external](https://example.com/#OLD)\n\n\`\`\`text\n[code](#OLD)\n:::\n:::literal\n\`\`\`\n\nLast paragraph.\n:::\n\n${direct}\n\n# B {#b}\n`;
}
for (const eol of ['\n', '\r\n']) test(`edits preserve independent expected source ${JSON.stringify(eol)}`, () => {
  const source = '\uFEFF' + editable().replaceAll('\n', eol), doc = parseDocument(source);
  const operations = [
    { type: 'renameId', id: 'OLD', newId: 'NEW' },
    { type: 'setDirectiveAttribute', id: 'D', key: 'status', value: 'ready' },
    { type: 'replaceParagraph', id: 'NEW', index: 0, text: 'Changed outside' },
  ];
  const plan = planBatch(doc, { schemaVersion: 1, operations });
  assert.equal(plan.steps[0].edits.length, 3);
  assert.deepEqual(Buffer.from(plan.next.source), Buffer.from('\uFEFF' + editable('NEW', 'ready', 'Changed outside').replaceAll('\n', eol)));
  assert.throws(() => planOperation(doc, { type: 'replaceParagraph', id: 'OLD', index: 1, text: 'No' }), e => e.code === 'NARU_TARGET');
  const moved = planOperation(doc, { type: 'moveSection', id: 'OLD', after: 'b' });
  const split = source.indexOf('# B');
  assert.equal(moved.next.source, '\uFEFF' + source.slice(split) + source.slice(1, split));
  assert.equal(planOperation(doc, { type: 'renameId', id: 'OLD', newId: 'OLD' }).next.source, source);
});

test('HTML projects each child with escaping, safe links and CSP', () => {
  const source = '# A {#a}\n\n' + wrap('<script>alert(1)</script> [bad](javascript:evil) [ok](#a)\n\n- item\n\n3. ordered\n\n```html\n<img src=x onerror=evil>\n```');
  const html = renderHtml(parseDocument(source));
  assert.match(html, /<p>&lt;script&gt;alert\(1\)&lt;\/script&gt; bad <a href="#a"/);
  assert.match(html, /<ul><li>item<\/li><\/ul><ol start="3"><li>ordered<\/li><\/ol><pre><code>&lt;img src=x onerror=evil&gt;\n<\/code><\/pre><\/aside>/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:|<p><ul>|<p><pre>/);
  assert.match(html, /default-src 'none'/);
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = join(root, '.narudoc-scenarios');
const cli = (args, input) => spawnSync(process.execPath, [join(root, 'apps/cli/bin/narudoc.mjs'), ...args, '--json'], { encoding: 'utf8', input, timeout: 15000 });
const ok = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); };
test('CLI children contract, rename, batch and failure paths preserve bytes', async t => {
  await mkdir(outputRoot, { recursive: true });
  const dir = await mkdtemp(join(outputRoot, 'directive-test-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, 'document.narudoc');
  const source = '\uFEFF' + editable().replaceAll('\n', '\r\n');
  await writeFile(file, source);
  const inspected = ok(cli(['inspect', file])), revision = inspected.revision;
  const node = ok(cli(['get', file, '--id', 'D'])).node;
  assert.deepEqual(node, inspected.blocks[1]);
  assert.deepEqual(node.children.map(b => b.type), ['paragraph', 'list', 'code', 'paragraph']);
  assert.equal('body' in node, false);
  const unchanged = async () => assert.deepEqual(await readFile(file), Buffer.from(source));
  const renameArgs = ['id', 'rename', file, '--id', 'OLD', '--new-id', 'NEW', '--revision', revision];
  ok(cli([...renameArgs, '--dry-run'])); await unchanged();
  assert.equal(ok(cli(['id', 'rename', file, '--id', 'OLD', '--new-id', 'OLD'])).changed, false); await unchanged();
  const failure = (result, code, index) => {
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr).error;
    assert.equal(error.code, code); assert.equal(error.operationIndex, index);
  };
  failure(cli(['id', 'rename', file, '--id', 'OLD', '--new-id', 'NEW', '--revision', '0'.repeat(64)]), 'NARU_STALE'); await unchanged();
  await writeFile(file + '.lock', 'existing lock');
  failure(cli(renameArgs), 'NARU_LOCKED'); await unchanged();
  assert.equal(await readFile(file + '.lock', 'utf8'), 'existing lock');
  await rm(file + '.lock');
  const operations = [{ type: 'renameId', id: 'OLD', newId: 'NEW' }, { type: 'setHeadingTitle', id: 'NEW', title: 'New title' }];
  const batchArgs = ['batch', file, '--operations', '-', '--revision', revision];
  failure(cli(batchArgs, JSON.stringify({ schemaVersion: 1, operations: [...operations, { type: 'renameId', id: 'missing', newId: 'other' }] })), 'NARU_TARGET', 2); await unchanged();
  const input = JSON.stringify({ schemaVersion: 1, operations });
  const preview = ok(cli([...batchArgs, '--dry-run'], input)); await unchanged();
  const saved = ok(cli(batchArgs, input));
  assert.deepEqual(saved.steps, preview.steps); assert.equal(saved.nextRevision, preview.nextRevision);
  const expected = '\uFEFF' + editable('NEW').replace('# 한글 😀', '# New title').replaceAll('\n', '\r\n');
  assert.deepEqual(await readFile(file), Buffer.from(expected));
  assert.equal(ok(cli(['validate', file])).valid, true);
  const html = ok(cli(['render', file, '--to', 'html'])).html;
  assert.match(html, /id="NEW"/); assert.equal((html.match(/href="#NEW"/g) || []).length, 2);
  assert.match(html, /\[code\]\(#OLD\)/);
  // Exercise an actual single-command save on the same structured body as well.
  ok(cli(['id', 'rename', file, '--id', 'NEW', '--new-id', 'FINAL', '--revision', saved.nextRevision]));
  assert.deepEqual(await readFile(file), Buffer.from('\uFEFF' + editable('FINAL').replace('# 한글 😀', '# New title').replaceAll('\n', '\r\n')));
});
