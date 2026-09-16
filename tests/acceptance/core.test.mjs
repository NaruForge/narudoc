import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseDocument, assertValid, validateDocument, outline, sections, getById, getSection, planOperation, applyPlan, applyTextEdits, createDocument } from '../../packages/core/dist/index.js';
import { boundary } from '../../packages/model/dist/index.js';

const fixtureDir = new URL('../fixtures/', import.meta.url);
for (const file of await readdir(fixtureDir)) {
  test(`fidelity: ${file}`, async () => {
    const bytes = await readFile(new URL(file, fixtureDir)), source = bytes.toString('utf8');
    const doc = parseDocument(source); assertValid(doc);
    const before = JSON.stringify(doc);
    const noop = planOperation(doc, { type: 'setHeadingTitle', id: 'control', title: '제어' });
    assert.deepEqual(noop.edits, []);
    assert.deepEqual(Buffer.from(applyPlan(source, noop)), bytes);
    const title = planOperation(doc, { type: 'setHeadingTitle', id: 'control', title: '전압 제어' });
    assert.equal(applyPlan(source, title), source.replace('## 제어', '## 전압 제어'));
    const paragraph = planOperation(doc, { type: 'replaceParagraph', id: 'control', index: 0, text: 'The voltage is 420 V. 한글 Ω 😀' });
    assert.equal(applyPlan(source, paragraph), source.replace('400', '420'));
    assert.equal(JSON.stringify(doc), before, 'operations do not mutate input snapshots');
    assert.equal(title.edits.length, 1); assert.equal(paragraph.edits.length, 1);
  });
}
const source = '# Root {#root}\n\n## A {#a}\n\nA   text.\n\n### Child {#child}\n\nChild.\n\n## B {#b}\n\nB.\n\n## C {#c}\n\nC.';
const apply = (text, op) => planOperation(parseDocument(text), op).next.source;
test('all blocks, stable IDs, refs and literal code', async () => {
  const doc = parseDocument(await readFile(new URL('../../examples/engineering.narudoc', import.meta.url), 'utf8'));
  assertValid(doc);
  assert.deepEqual(outline(doc).map(s => s.id), ['system-architecture', 'dc-link-control', 'validation']);
  assert.equal(getById(doc, 'REQ-001').type, 'directive');
  assert.throws(() => getById(doc, 'not-a-heading'), { code: 'NARU_TARGET' });
  assert.deepEqual([...new Set(doc.blocks.map(b => b.type))].sort(), ['code', 'directive', 'heading', 'list', 'metadata', 'paragraph']);
});
test('sections include descendants and track parent identity', () => {
  const doc = parseDocument(source), all = sections(doc);
  assert.equal(getSection(doc, 'a').end, source.indexOf('## B'));
  assert.equal(all.find(s => s.heading.id === 'child').parentStart, source.indexOf('## A'));
  assert.equal(all.find(s => s.heading.id === 'b').parentStart, 0);
});
test('move preserves entire subtree source and spaces', () => {
  const doc = parseDocument(source), a = getSection(doc, 'a'), b = getSection(doc, 'b');
  const chunk = source.slice(a.start, a.end);
  const next = apply(source, { type: 'moveSection', id: 'a', after: 'b' });
  assert.equal(next, source.slice(0, a.start) + source.slice(a.end, b.end) + chunk + source.slice(b.end));
  assert.equal(next.slice(next.indexOf('## A'), next.indexOf('## C {#c}')), chunk);
  assert.deepEqual(outline(parseDocument(next)).map(s => s.id), ['root', 'b', 'a', 'child', 'c']);
});
test('move last unterminated section earlier adds only boundary newlines', () => {
  const next = apply(source, { type: 'moveSection', id: 'c', after: 'a' });
  assert.match(next, /C\.\n## B/);
  assert.deepEqual(outline(parseDocument(next)).map(s => s.id), ['root', 'a', 'child', 'c', 'b']);
});
test('move first section to EOF without final newline', () => {
  const next = apply(source, { type: 'moveSection', id: 'a', after: 'c' });
  assert.match(next, /C\.\n## A/);
  assertValid(parseDocument(next));
});
test('same target and already-adjacent moves are no-ops', () => {
  assert.equal(apply(source, { type: 'moveSection', id: 'b', after: 'a' }), source);
  assert.equal(apply(source, { type: 'moveSection', id: 'a', after: 'a' }), source);
});
test('move cannot reparent or insert into descendants', () => {
  assert.throws(() => apply(source, { type: 'moveSection', id: 'a', after: 'child' }), { code: 'NARU_ARGUMENT' });
});
test('insert and remove sections preserve original text', () => {
  const inserted = apply(source, { type: 'insertSection', id: 'new', after: 'b', title: 'New' });
  assert.equal(inserted, source.replace('## C {#c}', '## New {#new}\n\n## C {#c}'));
  assert.equal(apply(inserted, { type: 'removeSection', id: 'new' }), source);
  const end = apply(source, { type: 'insertSection', id: 'new', after: 'c', title: 'New' });
  assert.equal(end, source + '\n## New {#new}\n\n');
});
test('heading title replacement preserves closing marker and anchor spacing', () => {
  const original = '#  Old   ###   {#a}  \r\n';
  assert.equal(apply(original, { type: 'setHeadingTitle', id: 'a', title: 'New' }), '#  New   ###   {#a}  \r\n');
});
test('paragraph replacement allows existing document references', () => {
  const next = apply(source, { type: 'replaceParagraph', id: 'a', index: 0, text: 'See [B](#b).' });
  assert.match(next, /See \[B\]\(#b\)/);
});
test('paragraph scope excludes child sections', () => {
  assert.throws(() => apply(source, { type: 'replaceParagraph', id: 'a', index: 1, text: 'No' }), { code: 'NARU_TARGET' });
});
test('paragraph replacement rejects structural injection', () => {
  for (const text of ['# Inject', 'Two\n\nparagraphs', '', 'End\n', '```js\na\n```']) {
    assert.throws(() => apply(source, { type: 'replaceParagraph', id: 'a', index: 0, text }), { code: 'NARU_ARGUMENT' });
  }
});
test('directive existing value preserves formatting; new key preserves body', () => {
  const original = ':::requirement\r\nid: REQ-1\r\nstatus :\t draft  \r\n\r\nBody.\r\n:::\r\n';
  assert.equal(apply(original, { type: 'setDirectiveAttribute', id: 'REQ-1', key: 'status', value: 'approved' }), original.replace('draft', 'approved'));
  assert.equal(apply(original, { type: 'setDirectiveAttribute', id: 'REQ-1', key: 'owner', value: 'team' }), original.replace('\r\n\r\nBody', '\r\nowner: team\r\n\r\nBody'));
  assert.equal(apply(original, { type: 'setDirectiveAttribute', id: 'REQ-1', key: 'status', value: 'draft' }), original);
});
test('directive with no body supports new attribute', () => {
  const original = ':::figure\nid: fig-a\n:::';
  assert.equal(apply(original, { type: 'setDirectiveAttribute', id: 'fig-a', key: 'src', value: './a.svg' }), ':::figure\nid: fig-a\nsrc: ./a.svg\n:::');
});
test('ID and scalar injection rejected', () => {
  for (const title of [' ', 'New\n# Inject', 'New {#evil}', 'New ###', '\ud800']) assert.throws(() => createDocument(title), { code: 'NARU_ARGUMENT' });
  assert.throws(() => createDocument('Okay', 'not valid'), { code: 'NARU_ARGUMENT' });
  const original = ':::x\nid: a\n:::\n';
  for (const key of ['id', '__proto__', 'constructor', 'prototype', 'bad key']) assert.throws(() => apply(original, { type: 'setDirectiveAttribute', id: 'a', key, value: 'v' }), { code: 'NARU_ARGUMENT' });
  assert.throws(() => apply(original, { type: 'setDirectiveAttribute', id: 'a', key: 'x', value: 'one\n:::' }), { code: 'NARU_ARGUMENT' });
});
for (const [name, text, code] of [
  ['duplicate id', '# A {#a}\n\n# B {#a}', 'NARU_DUPLICATE_ID'],
  ['bad id', '# A {#1bad}', 'NARU_ID'],
  ['broken ref', '# A {#a}\n\n[B](#b)', 'NARU_REFERENCE'],
  ['bad percent ref', '[B](#%zz)', 'NARU_REFERENCE'],
  ['unclosed directive', ':::x\nid: a', 'NARU_DIRECTIVE'],
  ['stray delimiter', ':::', 'NARU_DIRECTIVE'],
  ['nested directive', ':::x\n\n:::y\n:::\n:::', 'NARU_DIRECTIVE_NESTED'],
  ['duplicate attribute', ':::x\nid: a\nid: b\n:::', 'NARU_ATTRIBUTE_DUPLICATE'],
  ['bad attribute', ':::x\nbad line\n:::', 'NARU_ATTRIBUTE'],
  ['unclosed metadata', '---\ntitle: a', 'NARU_METADATA'],
  ['unclosed code', '```ts\nconst a = 1', 'NARU_FENCE'],
  ['nul', '# A\n\n\0', 'NARU_ENCODING'],
  ['lone surrogate', '# A\n\n\ud800', 'NARU_ENCODING'],
]) test(`diagnostic: ${name}`, () => {
  const doc = parseDocument(text);
  assert.ok(validateDocument(doc).some(d => d.code === code));
  assert.throws(() => assertValid(doc), { code: 'NARU_INVALID_DOCUMENT' });
});
test('deleting referenced subtree rejected without original mutation', () => {
  const text = '# A {#a}\n\n[B](#b)\n\n# B {#b}\n';
  assert.throws(() => apply(text, { type: 'removeSection', id: 'b' }), { code: 'NARU_INVALID_DOCUMENT' });
});
test('heading hierarchy skip is a warning, not automatic corruption', () => {
  const doc = parseDocument('### Heading {#h}');
  assert.equal(validateDocument(doc)[0].severity, 'warning'); assertValid(doc);
});
test('patch validates full revision, expected text, ranges and overlaps', () => {
  const plan = planOperation(parseDocument(source), { type: 'setHeadingTitle', id: 'a', title: 'Another' });
  assert.throws(() => applyPlan(source + 'x', plan), { code: 'NARU_STALE' });
  assert.throws(() => applyTextEdits('abc', [{ start: 0, end: 1, expected: 'z', text: 'x' }]), { code: 'NARU_STALE' });
  for (const [start, end] of [[-1, 0], [2, 1], [0, 4], [0.5, 1]]) assert.throws(() => applyTextEdits('abc', [{ start, end, expected: '', text: '' }]), { code: 'NARU_PATCH' });
  assert.throws(() => applyTextEdits('abc', [{ start: 0, end: 2, expected: 'ab', text: '' }, { start: 1, end: 3, expected: 'bc', text: '' }]), { code: 'NARU_PATCH' });
  assert.throws(() => applyTextEdits('abc', [{ start: 1, end: 1, expected: '', text: 'a' }, { start: 1, end: 1, expected: '', text: 'b' }]), { code: 'NARU_PATCH' });
  assert.throws(() => applyTextEdits('😀', [{ start: 0, end: 1, expected: '\ud83d', text: '' }]), { code: 'NARU_PATCH' });
});
test('Unicode minimal edits never split surrogate pairs (deterministic property cases)', () => {
  const values = ['😀', '😁', '한글', 'A😀B', 'A😁B', 'Ωµ°C', 'e\u0301', '文字'];
  for (const old of values) for (const title of values) {
    const text = `# ${old} {#h}\r\n\r\nKeep   spacing.\r\n`;
    const plan = planOperation(parseDocument(text), { type: 'setHeadingTitle', id: 'h', title });
    assert.equal(plan.next.source, `# ${title} {#h}\r\n\r\nKeep   spacing.\r\n`);
    for (const edit of plan.edits) assert.ok(boundary(text, edit.start) && boundary(text, edit.end));
  }
});
test('unknown syntax stays literal and source positions remain aligned', () => {
  const doc = parseDocument('\ufeff# 한글 😀 {#h}\r\n\r\n> literal\r\n| a | b |\r\n');
  assert.equal(doc.blocks[0].range.start, 1);
  const next = planOperation(doc, { type: 'setHeadingTitle', id: 'h', title: 'Changed' }).next;
  assert.equal(next.source, doc.source.replace('한글 😀', 'Changed'));
});
