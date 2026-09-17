import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, resolveReferences, validateDocument, planOperation, planSequence, getTable, getById } from '../../packages/core/dist/index.js';
import { inlineText } from '../../packages/model/dist/index.js';
import { renderHtml, renderBlockHtml } from '../../packages/renderer-html/dist/index.js';
import { SourceSession } from '../../packages/editor-adapter/dist/session.js';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { revision } from '../../packages/file-store/dist/index.js';

const table = '| Parameter | Value |\n| --- | --- |\n| Voltage | 400 |';
test('duplicate-heavy invalid snapshots keep every diagnostic and never resolve ambiguous references', () => {
  const count = 10000;
  const doc = parseDocument(Array(count).fill('# H {#same}').join('\n\n') + '\n\n[@same] [literal](#same)');
  const context = resolveReferences(doc);
  assert.equal(context.definitions.length, count);
  assert.equal(context.diagnostics.filter(d => d.code === 'NARU_DUPLICATE_ID').length, count - 1);
  assert.equal(context.diagnostics.filter(d => d.code === 'NARU_REFERENCE').length, 2);
  assert.equal(context.references.length, 2);
  assert.ok(context.references.every(r => r.target === undefined && r.label === undefined));
  assert.ok(renderHtml(doc, context).includes('<span class="unresolved-reference">[@same]</span>'));
});
test('table annotation is one object with exact ranges and derived reference labels', () => {
  for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\ufeff']) {
    const source = (bom + '# 한글😀 {#control}\n\nSee [@tab-id] and [literal](#tab-id).\n\n@table caption="Control parameters" id="tab-id"\n\n' + table).replaceAll('\n', eol);
    const doc = parseDocument(source), node = doc.blocks[2], resolved = resolveReferences(doc);
    assert.equal(node.type, 'table'); assert.equal(doc.blocks.length, 3);
    assert.equal(source.slice(node.idRange.start, node.idRange.end), 'tab-id');
    assert.equal(source.slice(node.captionRange.start, node.captionRange.end), '"Control parameters"');
    assert.equal(source.slice(node.range.start, node.range.end), ('@table caption="Control parameters" id="tab-id"\n\n' + table).replaceAll('\n', eol));
    assert.equal(resolved.references[0].label, 'Table 1'); assert.equal(resolved.references[1].label, undefined);
    assert.deepEqual(validateDocument(doc), []);
  }
});

test('create, annotate, reference, renumber, caption and rename preserve independent source bytes', () => {
  let doc = parseDocument('# First {#first}\n\nFirst.\n\n# Control {#control}\n\nSee .\n\n' + table);
  const run = op => { doc = planOperation(doc, op).next; };
  const original = doc.source;
  run({ type: 'setTableMetadata', sectionId: 'control', tableIndex: 0, id: 'tab-parameters', caption: 'Control parameters' });
  assert.equal(doc.source, original.replace(table, '@table id="tab-parameters" caption="Control parameters"\n' + table));
  run({ type: 'insertReference', id: 'control', index: 0, path: '0', offset: 4, expected: 'See .', targetId: 'tab-parameters' });
  assert.ok(doc.source.includes('See [@tab-parameters].'));
  run({ type: 'insertTable', sectionId: 'first', id: 'tab-first', headers: ['A'], rows: [] });
  assert.equal(resolveReferences(doc).references[0].label, 'Table 2');
  const beforeMove = doc.source;
  run({ type: 'moveSection', id: 'first', after: 'control' });
  assert.equal(resolveReferences(doc).references[0].label, 'Table 1');
  assert.ok(doc.source.includes('See [@tab-parameters].'));
  const beforeCaption = doc.source;
  run({ type: 'setTableMetadata', sectionId: 'control', tableIndex: 0, caption: 'Control limits' });
  assert.equal(doc.source, beforeCaption.replace('caption="Control parameters"', 'caption="Control limits"'));
  const beforeRename = doc.source;
  run({ type: 'renameId', id: 'tab-parameters', newId: 'tab-limits' });
  assert.equal(doc.source, beforeRename.replaceAll('tab-parameters', 'tab-limits'));
  const beforeCell = doc.source;
  run({ type: 'setTableCell', sectionId: 'control', tableIndex: 0, part: 'body', row: 0, column: 1, text: '420' });
  assert.equal(doc.source, beforeCell.replace('400', '420'));
  run({ type: 'setReferenceTarget', id: 'control', index: 0, path: '1', expectedTargetId: 'tab-limits', targetId: 'tab-first' });
  assert.equal(resolveReferences(doc).references[0].label, 'Table 2');
  assert.throws(() => planOperation(doc, { type: 'setReferenceTarget', id: 'control', index: 0, path: '1', expectedTargetId: 'tab-limits', targetId: 'tab-first' }), { code: 'NARU_STALE' });
  const context = resolveReferences(doc), html = renderHtml(doc, context);
  assert.ok(html.includes('<caption>Table 1: Control limits</caption>'));
  assert.ok(html.includes('href="#tab-first" data-reference="tab-first">Table 2</a>'));
  assert.throws(() => renderHtml(doc), { code: 'NARU_RENDER_CONTEXT' });
  assert.throws(() => renderHtml(parseDocument(doc.source), context), { code: 'NARU_RENDER_CONTEXT' });
  assert.throws(() => renderBlockHtml(getTable(parseDocument(doc.source), 'control', 0), context), { code: 'NARU_RENDER_CONTEXT' });
  assert.notEqual(beforeMove, doc.source);
});

test('Table 9 to 10 uses snapshot display offsets and exact save undo replay', () => {
  const tables = Array.from({ length: 9 }, (_, i) => `@table id="t${i + 1}"\n| X |\n| --- |`).join('\n\n');
  const original = '# Before {#before}\n\nB.\n\n# Main {#main}\n\nSee [@t9] end.\n\n' + tables;
  const session = new SourceSession(original, { historyLimit: 10 });
  const display = () => inlineText(session.snapshot.blocks.find(b => b.type === 'paragraph' && b.inline.some(n => n.type === 'reference')).inline, resolveReferences(session.snapshot));
  assert.equal(display(), 'See Table 9 end.');
  session.apply({ type: 'insertTable', sectionId: 'before', id: 't0', headers: ['X'], rows: [] });
  assert.equal(display(), 'See Table 10 end.');
  const base = session.source; session.acknowledgeSave(base, 'base');
  session.gesture([{ type: 'replaceParagraphRange', id: 'main', from: { index: 0, offset: 13 }, to: { index: 0, offset: 16 }, expected: 'end', text: 'tail' }]);
  assert.equal(session.source, base.replace('[@t9] end.', '[@t9] tail.'));
  const saved = session.source; session.acknowledgeSave(saved, 'saved'); session.undoGesture();
  assert.equal(session.source, base); assert.equal(planSequence(parseDocument(saved), session.operations).next.source, base);
  session.redoGesture(); assert.equal(session.source, saved);
  session.gesture([{ type: 'splitParagraph', id: 'main', index: 0, offset: 12, expected: 'See Table 10 tail.' }]);
  assert.equal(session.source, saved.replace('[@t9] tail.', '[@t9]\n\n tail.'));
  session.undoGesture(); assert.equal(session.source, saved);
  assert.throws(() => planOperation(session.snapshot, { type: 'replaceParagraphRange', id: 'main', from: { index: 0, offset: 5 }, to: { index: 0, offset: 6 }, expected: 'a', text: 'x' }), { code: 'NARU_ARGUMENT' });
});

test('annotation updates preserve escaped caption and whitespace and semantic references cannot change other markup', () => {
  const source = '# H {#h}\n\nA **bold**.\n\n@table  caption="old\\\"quote"   id="tab"\n' + table;
  const doc = parseDocument(source);
  assert.equal(planOperation(doc, { type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, caption: 'old"quote' }).next.source, source);
  assert.equal(planOperation(doc, { type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, caption: 'new' }).next.source, source.replace('"old\\\"quote"', '"new"'));
  assert.equal(planOperation(doc, { type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, caption: '' }).next.source, source.replace('  caption="old\\\"quote"', ''));
  const inserted = planOperation(doc, { type: 'insertReference', id: 'h', index: 0, path: '1.0', offset: 2, expected: 'bold', targetId: 'tab' }).next;
  assert.equal(inserted.source, source.replace('**bold**', '**bo[@tab]ld**'));
  assert.throws(() => planOperation(doc, { type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, id: 'new' }), { code: 'NARU_ARGUMENT' });
  const unsafe = planOperation(doc, { type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, caption: '<script>alert(1)</script>' }).next;
  assert.ok(renderHtml(unsafe, resolveReferences(unsafe)).includes('&lt;script&gt;'));
});
test('annotation and reference failures are diagnosed without executing code or escaped text', () => {
  for (const annotation of ['@table id="tab" id="again"', '@table caption="No id"', '@table id="tab" other="x"', '@table id="1bad"', '@table id="tab" caption="\\n"', '@table id="tab"\n\n']) {
    assert.ok(validateDocument(parseDocument('# H {#h}\n\n' + annotation + '\n' + table)).some(d => d.severity === 'error'), annotation);
  }
  const doc = parseDocument('# H {#h}\n\n`[@fake]` \\[@fake] [@h](#h) [@h] [@missing] [@unclosed');
  assert.deepEqual(resolveReferences(doc).references.map(r => r.id), ['h', 'h', 'missing', 'unclosed']);
  assert.ok(validateDocument(doc).some(d => d.code === 'NARU_REFERENCE_KIND'));
  assert.ok(validateDocument(doc).some(d => d.code === 'NARU_REFERENCE_SYNTAX'));
});

test('reference traversal covers inline contexts once, rename changes destinations only', () => {
  const source = '# [@tab] {#h}\r\n\r\n**[@tab]** [literal](#%74ab) `[@tab]` \\[@tab] Table 1.\r\n\r\n- [@tab]\r\n\r\n:::note\r\nid: note\r\n\r\n[@tab]\r\n\r\n```\r\n[@tab]\r\n```\r\n:::\r\n\r\n@table id="tab" caption="[@tab] Table 1"\r\n| [@tab] |\r\n| --- |\r\n| [@tab](https://example.com) |';
  const doc = parseDocument(source), context = resolveReferences(doc);
  assert.deepEqual(validateDocument(doc), []); assert.equal(context.references.length, 6);
  const changed = planOperation(doc, { type: 'renameId', id: 'tab', newId: 'new' }).next.source;
  const expected = '# [@new] {#h}\r\n\r\n**[@new]** [literal](#new) `[@tab]` \\[@tab] Table 1.\r\n\r\n- [@new]\r\n\r\n:::note\r\nid: note\r\n\r\n[@new]\r\n\r\n```\r\n[@tab]\r\n```\r\n:::\r\n\r\n@table id="new" caption="[@tab] Table 1"\r\n| [@new] |\r\n| --- |\r\n| [@tab](https://example.com) |';
  assert.equal(changed, expected);
  assert.equal(planOperation(doc, { type: 'renameId', id: 'tab', newId: 'tab' }).next.source, source);
  assert.throws(() => planOperation(doc, { type: 'renameId', id: 'tab', newId: 'h' }));
});

test('unannotated tables retain indices and marks around references survive partial split', () => {
  const source = '# H {#h}\n\n**A [@tab] Z**.\n\n' + table + '\n\n@table id="tab"\n' + table;
  const doc = parseDocument(source), context = resolveReferences(doc);
  assert.equal(getTable(doc, 'h', 0).id, undefined); assert.equal(getTable(doc, 'h', 1).id, 'tab');
  assert.equal(context.definitions.find(d => d.id === 'tab').number, 1);
  const split = planOperation(doc, { type: 'splitParagraph', id: 'h', index: 0, offset: 1, expected: 'A Table 1 Z.' }).next;
  assert.equal(split.source, source.replace('**A [@tab] Z**.', '**A**\n\n** [@tab] Z**.'));
});

test('annotation failure boundaries, escaped IDs and mixed-EOL metadata updates', () => {
  for (const source of ['@table id="tab"\n' + table, '# H {#h}\n\n@table id="tab"', '# H {#h}\n\n@table id="tab"\n@table id="other"\n' + table, '# H {#tab}\n\n@table id="tab"\n' + table]) {
    assert.ok(validateDocument(parseDocument(source)).some(d => d.severity === 'error'));
  }
  const literal = parseDocument('# H {#h}\n\n```\n@table id="tab"\n```\n\n:::note\nid: n\n\n@table id="tab"\n:::\n\n\\@table id="tab"');
  assert.deepEqual(validateDocument(literal), []); assert.equal(literal.blocks.filter(b => b.type === 'table').length, 0);
  const source = '\ufeff# H {#h}\r\n\nSee [@tab].\r\n\r\n@table id="\\u0074ab" caption="Old"\n' + table;
  const doc = parseDocument(source); assert.deepEqual(validateDocument(doc), []);
  assert.equal(planOperation(doc, { type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, caption: 'New😀' }).next.source, source.replace('"Old"', '"New😀"'));
  assert.equal(planOperation(doc, { type: 'renameId', id: 'tab', newId: 'new' }).next.source, source.replace('[@tab]', '[@new]').replace('"\\u0074ab"', '"new"'));
});

test('CLI annotated insertion/query/render and late batch failure preserve file bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'naru-refs-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'refs.narudoc'), cliPath = fileURLToPath(new URL('../../apps/cli/bin/narudoc.mjs', import.meta.url));
  const cli = (args, input) => spawnSync(process.execPath, [cliPath, ...args], { input, encoding: 'utf8' });
  await writeFile(file, '# H {#h}\n\nSee .');
  const created = cli(['table', 'insert', file, '--section', 'h', '--from', '-', '--json'], JSON.stringify({ id: 'tab', caption: 'Parameters', headers: ['X'], rows: [] }));
  assert.equal(created.status, 0, created.stderr);
  const inserted = cli(['reference', 'insert', file, '--id', 'h', '--index', '0', '--path', '0', '--offset', '4', '--expected', 'See .', '--target-id', 'tab', '--json']);
  assert.equal(inserted.status, 0, inserted.stderr);
  const expected = '# H {#h}\n\nSee [@tab].\n\n@table id="tab" caption="Parameters"\n| X |\n| --- |';
  assert.equal(await readFile(file, 'utf8'), expected);
  const query = cli(['table', 'get', file, '--id', 'tab', '--json']); assert.equal(query.status, 0, query.stderr);
  assert.equal(JSON.parse(query.stdout).resolved.definitions.find(d => d.id === 'tab').label, 'Table 1');
  assert.equal(cli(['table', 'get', file, '--id', 'tab', '--index', '0']).status, 2);
  assert.equal(cli(['table', 'get', file, '--id', 'h']).status, 2);
  const rendered = cli(['render', file, '--to', 'html']); assert.equal(rendered.status, 0, rendered.stderr); assert.ok(rendered.stdout.includes('<caption>Table 1: Parameters</caption>'));
  const bad = cli(['batch', file, '--operations', '-', '--revision', revision(expected), '--json'], JSON.stringify({ schemaVersion: 1, operations: [{ type: 'setTableMetadata', sectionId: 'h', tableIndex: 0, caption: 'Changed' }, { type: 'setReferenceTarget', id: 'h', index: 0, path: '1', expectedTargetId: 'tab', targetId: 'missing' }] }));
  assert.notEqual(bad.status, 0); assert.equal(JSON.parse(bad.stderr).error.operationIndex, 1); assert.equal(await readFile(file, 'utf8'), expected);
});
