import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, planOperation, planBatch, applyTextEdits, validateDocument } from '../../packages/core/dist/index.js';
import { renderHtml } from '../../packages/renderer-html/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = join(root, '.narudoc-scenarios');
const bin = join(root, 'apps/cli/bin/narudoc.mjs');
const cli = (args, input) => spawnSync(process.execPath, [bin, ...args, '--json'], { encoding: 'utf8', input, timeout: 15000 });
const ok = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); };
const fail = (result, status, code, index) => {
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, code);
  assert.equal(error.operationIndex, index);
};
const rename = (id, newId) => ({ type: 'renameId', id, newId });
const batch = operations => JSON.stringify({ schemaVersion: 1, operations });

// Construct expected text from explicitly marked semantic destinations, not a global replace.
function fixture(id = 'OLD') {
  return `---
note: [metadata](#OLD)
---
# 한글 😀 [heading](#${id}) ##  {#${id}}  

OLD and #OLD stay. [OLD](#${id}) and [encoded](#${id === 'OLD' ? '%4fLD' : id}).
**[strong](#${id})** and *[emphasis](#${id})*.

- 😀 [bullet](#${id})
+ [second](#${id})
1. [ordered](#${id})
2) [ordered2](#${id})

:::requirement
id: REQ-1
note: [attribute](#OLD)

[body](#${id})
**[nested body](#${id})**
:::

\`[inline code](#OLD)\` and \\[escaped](#OLD).
[external](https://example.com/#OLD) [relative](other.narudoc#OLD).

\`\`\`text
# Code {#OLD}
[fenced](#OLD)
\`\`\`
`;
}
async function setup(t, source = fixture()) {
  await mkdir(outputRoot, { recursive: true });
  const dir = await mkdtemp(join(outputRoot, 'rename-test-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, '한글 문서.narudoc');
  await writeFile(file, source);
  const revision = ok(cli(['validate', file])).revision;
  return { dir, file, revision };
}

for (const eol of ['\n', '\r\n', '\r']) test(`rename heading preserves source and resolves links with ${JSON.stringify(eol)}`, () => {
  const source = '\uFEFF' + fixture().replaceAll('\n', eol);
  const expected = '\uFEFF' + fixture('NEW-ID').replaceAll('\n', eol);
  const doc = parseDocument(source), frozen = JSON.stringify(doc);
  const plan = planOperation(doc, rename('OLD', 'NEW-ID'));
  assert.equal(plan.next.source, expected);
  assert.equal(applyTextEdits(source, plan.edits), expected);
  assert.equal(JSON.stringify(doc), frozen);
  assert.deepEqual(validateDocument(plan.next), []);
  const html = renderHtml(plan.next);
  assert.match(html, /id="NEW-ID"/);
  assert.equal((html.match(/href="#NEW-ID"/g) || []).length, 11);
  assert.doesNotMatch(html, /href="#OLD"/);
  assert.match(html, /href="https:\/\/example.com\/#OLD"/);
  assert.match(html, /\[inline code\]\(#OLD\)/);
});

test('directive definition, self reference, spacing, encoded fragments and IDs with punctuation', () => {
  const source = '# A {#a}\n\n[REQ-1](#REQ-1) [encoded](#REQ%2D1)\n\n:::requirement\nid \t:  REQ-1  \nstatus: draft\n\n[self](#REQ-1)\n:::\n';
  const expected = '# A {#a}\n\n[REQ-1](#REQ-CTRL:1.2) [encoded](#REQ-CTRL:1.2)\n\n:::requirement\nid \t:  REQ-CTRL:1.2  \nstatus: draft\n\n[self](#REQ-CTRL:1.2)\n:::\n';
  const plan = planOperation(parseDocument(source), rename('REQ-1', 'REQ-CTRL:1.2'));
  assert.equal(plan.next.source, expected);
  assert.match(renderHtml(plan.next), /id="REQ-CTRL:1.2"/);
  assert.deepEqual(validateDocument(plan.next), []);
});

test('parser source ranges follow actual inline parsing including escape and nested markup', () => {
  const source = '# A **[self](#a)** ## {#a}  \n\n\\[literal](#a) `ignore [code](#a)` [a[b](#a) [bad](url bad) [ok](#a)\n';
  const doc = parseDocument(source);
  const heading = doc.blocks[0];
  assert.equal(source.slice(heading.idRange.start, heading.idRange.end), 'a');
  const ranges = [];
  function visit(nodes) {
    for (const node of nodes) {
      if (node.type === 'link') { ranges.push(node.urlRange); assert.equal(source.slice(node.urlRange.start, node.urlRange.end), node.url); }
      if ('children' in node) visit(node.children);
    }
  }
  for (const block of doc.blocks) if ('inline' in block) visit(block.inline);
  assert.equal(ranges.length, 3);
  const plan = planOperation(doc, rename('a', 'new'));
  assert.equal(plan.next.source, '# A **[self](#new)** ## {#new}  \n\n\\[literal](#a) `ignore [code](#a)` [a[b](#new) [bad](url bad) [ok](#new)\n');
});

test('rename rejects invalid IDs, collisions and invalid source without mutation; same ID is exact no-op', () => {
  const source = fixture(), doc = parseDocument(source), before = JSON.stringify(doc);
  for (const newId of ['', '1bad', 'space id', 'new\n', 'new\r', 'new\0', '\ud800', 42, 'REQ-1']) {
    assert.throws(() => planOperation(doc, rename('OLD', newId)), error => error.code === 'NARU_ARGUMENT');
  }
  assert.throws(() => planOperation(doc, rename('missing', 'new')), error => error.code === 'NARU_TARGET');
  const noop = planOperation(doc, rename('OLD', 'OLD'));
  assert.equal(noop.next.source, source); assert.deepEqual(noop.edits, []);
  assert.equal(JSON.stringify(doc), before);
  for (const broken of ['# A {#a}\n\n[bad](#missing)\n', '# A {#a}\n# B {#a}\n', '# A {#a}\n\n[bad](#%GG)\n']) {
    assert.throws(() => planOperation(parseDocument(broken), rename('a', 'new')), error => error.code === 'NARU_INVALID_DOCUMENT');
  }
});

test('missing source positions fail closed rather than partially updating references', () => {
  const doc = parseDocument('# A {#a}\n\n[self](#a)\n');
  delete doc.blocks[0].idRange;
  assert.throws(() => planOperation(doc, rename('a', 'new')), error => error.code === 'NARU_PATCH');
  const doc2 = parseDocument('# A {#a}\n\n[self](#a)\n');
  delete doc2.blocks[1].inline[0].urlRange;
  assert.throws(() => planOperation(doc2, rename('a', 'new')), error => error.code === 'NARU_PATCH');
});

test('single CLI rename supports dry-run/revision, HTML and byte-preserving no-op', async t => {
  const source = '\uFEFF' + fixture().replaceAll('\n', '\r\n');
  const { dir, file, revision } = await setup(t, source);
  const args = ['id', 'rename', file, '--id', 'OLD', '--new-id', 'NEW-ID', '--revision', revision];
  const preview = ok(cli([...args, '--dry-run']));
  assert.deepEqual(await readFile(file), Buffer.from(source));
  const saved = ok(cli(args));
  assert.equal(saved.nextRevision, preview.nextRevision);
  assert.deepEqual(saved.edits, preview.edits);
  assert.deepEqual(await readFile(file), Buffer.from('\uFEFF' + fixture('NEW-ID').replaceAll('\n', '\r\n')));
  assert.equal(ok(cli(['validate', file])).valid, true);
  const html = ok(cli(['render', file, '--to', 'html'])).html;
  assert.match(html, /id="NEW-ID"/); assert.match(html, /href="#NEW-ID"/);
  const before = await readFile(file), mtime = (await stat(file)).mtimeMs;
  const noop = ok(cli(['id', 'rename', file, '--id', 'NEW-ID', '--new-id', 'NEW-ID', '--revision', saved.nextRevision]));
  assert.equal(noop.changed, false); assert.deepEqual(noop.edits, []);
  assert.deepEqual(await readFile(file), before); assert.equal((await stat(file)).mtimeMs, mtime);
  fail(cli(args), 4, 'NARU_STALE'); assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readdir(dir), ['한글 문서.narudoc']);
});

test('CLI errors and cooperative lock preserve original bytes', async t => {
  const { file } = await setup(t);
  const before = await readFile(file);
  for (const newId of ['REQ-1', 'bad id', 'new\n']) fail(cli(['id', 'rename', file, '--id', 'OLD', '--new-id', newId]), 2, 'NARU_ARGUMENT');
  fail(cli(['id', 'rename', file, '--id', 'missing', '--new-id', 'new']), 2, 'NARU_TARGET');
  fail(cli(['id', 'rename', file, '--id', 'OLD']), 2, 'NARU_ARGUMENT');
  await writeFile(file + '.lock', 'live lock');
  fail(cli(['id', 'rename', file, '--id', 'OLD', '--new-id', 'new']), 4, 'NARU_LOCKED');
  assert.equal(await readFile(file + '.lock', 'utf8'), 'live lock');
  assert.deepEqual(await readFile(file), before);
});

test('batch rename allows subsequent new-ID operations; final failure saves none', async t => {
  const source = '# A {#a}\n\n[self](#a)\n';
  const { file, revision } = await setup(t, source);
  const operations = [rename('a', 'new'), { type: 'setHeadingTitle', id: 'new', title: 'Changed' }];
  const args = ['batch', file, '--operations', '-', '--revision', revision];
  fail(cli(args, batch([...operations, rename('missing', 'other')])), 2, 'NARU_TARGET', 2);
  assert.deepEqual(await readFile(file), Buffer.from(source));
  fail(cli(args, batch([{ type: 'renameId', id: 'a', newId: 1 }])), 2, 'NARU_ARGUMENT', 0);
  const preview = ok(cli([...args, '--dry-run'], batch(operations)));
  const saved = ok(cli(args, batch(operations)));
  assert.deepEqual(saved.steps, preview.steps);
  assert.equal(saved.nextRevision, preview.nextRevision);
  assert.equal(await readFile(file, 'utf8'), '# Changed {#new}\n\n[self](#new)\n');
  const back = planBatch(parseDocument(source), { schemaVersion: 1, operations: [rename('a', 'new'), rename('new', 'a')] });
  assert.equal(back.next.source, source);
  let replay = source;
  for (const step of saved.steps) replay = applyTextEdits(replay, step.edits);
  assert.equal(replay, await readFile(file, 'utf8'));
});
