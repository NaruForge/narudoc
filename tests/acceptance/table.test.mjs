import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { inlineText } from '../../packages/model/dist/index.js';
import { parseDocument, planOperation, planBatch, getTable, validateDocument, readTableInput } from '../../packages/core/dist/index.js';
import { renderHtml } from '../../packages/renderer-html/dist/index.js';
const set = (text = '420', extra = {}) => ({ type: 'setTableCell', sectionId: 'parameters', tableIndex: 0, part: 'body', row: 0, column: 1, text, ...extra });
const input = { headers: ['Parameter', 'Value', 'Unit'], rows: [['Voltage reference', '400', 'V'], ['Sample period', '50', 'us']] };
const insert = { type: 'insertTable', sectionId: 'parameters', ...input };
const before = '# Parameters  {#parameters}\n\nBefore 😀.\n\n| Parameter | Value | Unit |\n| ----- | --- | ---- |\n| Voltage reference  |  400\t| V |\n| Sample period | 50 | us |\n\nAfter 한글.\n\n## Child {#child}\n';
const expected = '# Parameters  {#parameters}\n\nBefore 😀.\n\n| Parameter | Value | Unit |\n| ----- | --- | ---- |\n| Voltage reference  |  420\t| V |\n| Sample period | 50 | us |\n\nAfter 한글.\n\n## Child {#child}\n';
for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) test(`table independent expected bytes ${JSON.stringify({eol,bom})}`, () => {
  const source = bom + before.replaceAll('\n', eol), doc = parseDocument(source);
  const plan = planOperation(doc, set());
  assert.deepEqual(Buffer.from(plan.next.source), Buffer.from(bom + expected.replaceAll('\n', eol)));
  assert.equal(plan.edits.length, 1); assert.equal(plan.edits[0].expected, '0'); assert.equal(plan.edits[0].text, '2');
  assert.deepEqual(planOperation(plan.next, set()).edits, []);
  const table = getTable(doc, 'parameters', 0);
  assert.equal(table.rows.length, 2);
  for (const row of [table.header, ...table.rows]) for (const cell of row.cells) {
    assert.equal(source.slice(cell.contentRange.start, cell.contentRange.end), inlineText(cell.inline));
    assert.ok(cell.range.start <= cell.contentRange.start && cell.range.end >= cell.contentRange.end);
  }
  const header = planOperation(doc, set('Name 😀', { part: 'header', row: 0, column: 0 }));
  assert.deepEqual(Buffer.from(header.next.source), Buffer.from(source.replace('| Parameter |', '| Name 😀 |')));
  assert.deepEqual(validateDocument(plan.next), []);
});
test('mixed EOL/EOF, empty cells and insertion preserve all existing bytes', () => {
  const source = '\uFEFF# Parameters {#parameters}\r\n\r\n| A | B |\n| --- | --- |\r|   |400|';
  assert.equal(planOperation(parseDocument(source), set()).next.source, '\uFEFF# Parameters {#parameters}\r\n\r\n| A | B |\n| --- | --- |\r|   |420|');
  const empty = planOperation(parseDocument(source), set('한😀', { column: 0 }));
  assert.equal(empty.next.source, '\uFEFF# Parameters {#parameters}\r\n\r\n| A | B |\n| --- | --- |\r|   한😀|400|');
  for (const tail of ['', '\n', '\r\n', '\r \t\n']) {
    const initial = '# Parameters {#parameters}' + tail;
    const doc = parseDocument(initial), plan = planOperation(doc, insert);
    const table = '| Parameter | Value | Unit |\n| --- | --- | --- |\n| Voltage reference | 400 | V |\n| Sample period | 50 | us |'.replaceAll('\n', doc.eol);
    assert.equal(plan.next.source, '# Parameters {#parameters}' + doc.eol.repeat(2) + table + tail);
  }
});
test('block boundaries, zero rows, direct table indices and literal contexts', () => {
  const source = '# Parameters {#parameters}\nparagraph\n| A |\n| --- |\n\n- list\n\n```\n| fake |\n| --- |\n```\n\n:::note\nid: N\n\n| literal |\n| --- |\n:::\n\n| B |\n| --- |\n| value |\n## Child {#child}\n| child |\n| --- |';
  const doc = parseDocument(source);
  assert.deepEqual(doc.blocks.map(b => b.type), ['heading', 'paragraph', 'table', 'list', 'code', 'directive', 'table', 'heading', 'table']);
  assert.equal(getTable(doc, 'parameters', 0).rows.length, 0);
  assert.equal(getTable(doc, 'parameters', 1).rows.length, 1);
  assert.throws(() => getTable(doc, 'parameters', 2), e => e.code === 'NARU_TARGET');
  assert.equal(doc.blocks[5].children[0].type, 'paragraph');
  for (const type of ['insertParagraph', 'replaceParagraph']) assert.throws(() => planOperation(doc, { type, id: 'parameters', index: 0, text: '| A |\n| --- |' }), e => e.code === 'NARU_ARGUMENT');
  const edited = planOperation(doc, { type: 'replaceParagraph', id: 'parameters', index: 0, text: 'Changed' });
  assert.equal(edited.next.source, source.replace('paragraph', 'Changed'));
  const directive = planOperation(doc, { type: 'replaceDirectiveParagraph', id: 'N', index: 0, text: 'Still literal' });
  assert.equal(directive.next.source, source.replace('| literal |\n| --- |', 'Still literal'));
  for (const literal of ['| A |\n| :--- |', 'A | B\n--- | ---', '| A |\n| -- |']) assert.equal(parseDocument('# H {#h}\n' + literal).blocks[1].type, 'paragraph');
  assert.equal(parseDocument('| A |\n| --- |').blocks[0].type, 'paragraph');
  for (const malformed of ['| A | B |\n| --- |', '| A |\n| --- |\n| a | b |']) assert.ok(validateDocument(parseDocument('# H {#h}\n' + malformed)).some(d => d.code === 'NARU_TABLE_COLUMNS'));
});
test('escaped pipe and code boundaries, references, rename and HTML safety', () => {
  const source = '# Parameters {#parameters}\n\n| A\\|B | `x|y` |\n| --- | --- |\n| **[yes](#parameters)** | `[fake](#missing)` |\n| <script>alert(1)</script> | [unsafe](javascript:alert) |';
  const doc = parseDocument(source), table = getTable(doc, 'parameters', 0);
  assert.equal(inlineText(table.header.cells[0].inline), 'A|B');
  assert.equal(table.header.cells[1].inline[0].type, 'code');
  assert.equal(table.header.cells[1].inline[0].value, 'x|y');
  assert.deepEqual(validateDocument(doc), []);
  const link = table.rows[0].cells[0].inline[0].children[0];
  assert.equal(source.slice(link.urlRange.start, link.urlRange.end), '#parameters');
  const renamed = planOperation(doc, { type: 'renameId', id: 'parameters', newId: 'new' });
  assert.equal(renamed.next.source, source.replace('{#parameters}', '{#new}').replace('](#parameters)', '](#new)'));
  assert.equal(renamed.edits.length, 2);
  const html = renderHtml(doc);
  assert.match(html, /<table><thead><tr><th>A\|B<\/th><th><code>x\|y<\/code>/);
  assert.match(html, /<tbody>/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /href="javascript:|<script>/);
  assert.throws(() => planOperation(doc, set('[bad](#missing)')), e => e.code === 'NARU_INVALID_DOCUMENT');
  assert.equal(getTable(parseDocument('# H {#h}\n| A\\\\| B |\n| --- | --- |'), 'h', 0).header.cells.length, 2);
  const labelled = parseDocument('# H {#h}\n| [A\\|B](#h) |\n| --- |');
  assert.match(renderHtml(labelled), />A\|B<\/a>/);
  assert.equal(planOperation(labelled, { type: 'renameId', id: 'h', newId: 'new' }).next.source, '# H {#new}\n| [A\\|B](#new) |\n| --- |');
});
test('strict DTO/cell coordinates, invalid syntax and batch insert then edit', () => {
  const doc = parseDocument('# Parameters {#parameters}\n');
  const batch = planBatch(doc, { schemaVersion: 1, operations: [insert, set()] });
  assert.equal(inlineText(getTable(batch.next, 'parameters', 0).rows[0].cells[1].inline), '420');
  for (const bad of [null, {}, { ...input, extra: true }, { headers: [], rows: [] }, { headers: ['A'], rows: [['x', 'y']] }, { headers: [1], rows: [] }]) assert.throws(() => readTableInput(bad), e => e.code === 'NARU_ARGUMENT');
  for (const text of ['a|b', 'x\ny', ' x', 'x ', '\ud800', '\0']) assert.throws(() => planOperation(batch.next, set(text)), e => e.code === 'NARU_ARGUMENT');
  for (const extra of [{ tableIndex: 5 }, { row: 5 }, { column: -1 }, { column: 1.5 }, { sectionId: 'missing' }]) assert.throws(() => planOperation(batch.next, set('x', extra)), e => e.code === 'NARU_TARGET');
  for (const extra of [{ part: 'other' }, { row: -1 }, { part: 'header', row: 1 }]) assert.throws(() => planOperation(batch.next, set('x', extra)), e => e.code === 'NARU_ARGUMENT');
  for (const operation of [{ ...insert, extra: 1 }, { ...set(), row: '0' }, { ...set(), extra: 1 }]) assert.throws(() => planBatch(batch.next, { schemaVersion: 1, operations: [operation] }), e => e.code === 'NARU_ARGUMENT' && e.operationIndex === 0);
  assert.throws(() => planBatch(doc, { schemaVersion: 1, operations: [insert, set(), set('bad', { row: 99 })] }), e => e.operationIndex === 2);
  assert.equal(doc.source, '# Parameters {#parameters}\n');
  assert.throws(() => planOperation(doc, { type: 'insertTable', sectionId: 'parameters', headers: ['a`', '`b'], rows: [] }), e => e.code === 'NARU_ARGUMENT');
  const dashRows = planOperation(doc, { type: 'insertTable', sectionId: 'parameters', headers: ['A'], rows: [['value'], ['---']] });
  assert.equal(getTable(dashRows.next, 'parameters', 0).rows.length, 2);
});
const root = fileURLToPath(new URL('../../', import.meta.url)), outputRoot = join(root, '.narudoc-scenarios');
test('large bounded table creates every row without changing values', () => {
  const rows = Array.from({ length: 20000 }, (_, i) => [String(i)]);
  const plan = planOperation(parseDocument('# Parameters {#parameters}\n'), { type: 'insertTable', sectionId: 'parameters', headers: ['Index'], rows });
  const table = getTable(plan.next, 'parameters', 0);
  assert.equal(table.rows.length, rows.length);
  assert.equal(inlineText(table.rows[19999].cells[0].inline), '19999');
});
const cli = (args, input) => spawnSync(process.execPath, [join(root, 'apps/cli/bin/narudoc.mjs'), ...args, '--json'], { encoding: 'utf8', input, timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
const ok = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return JSON.parse(r.stdout); };
const fail = (r, code) => { assert.notEqual(r.status, 0); assert.equal(JSON.parse(r.stderr).error.code, code); };
async function temporary(t) {
  await mkdir(outputRoot, { recursive: true }); const dir = await mkdtemp(join(outputRoot, 'table-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); }); return dir;
}
test('CLI create/read/cell edit, strict input, revisions, locks and rollback', async t => {
  const dir = await temporary(t), file = join(dir, 'document.narudoc');
  const created = ok(cli(['new', file, '--id', 'parameters', '--title', 'Parameters']));
  const original = await readFile(file);
  const args = ['table', 'insert', file, '--section', 'parameters', '--from', '-', '--revision', created.revision];
  for (const json of ['{"headers":["A"],"headers":["B"],"rows":[]}', '{"headers":["A"],"rows":[],"extra":1}', '{']) { fail(cli(args, json), 'NARU_ARGUMENT'); assert.deepEqual(await readFile(file), original); }
  fail(cli(args, Buffer.from([0xff])), 'NARU_ENCODING');
  ok(cli([...args, '--dry-run'], '\uFEFF' + JSON.stringify(input))); assert.deepEqual(await readFile(file), original);
  const saved = ok(cli(args, JSON.stringify(input)));
  assert.equal(ok(cli(['table', 'get', file, '--section', 'parameters', '--index', '0'])).node.rows.length, 2);
  const cellArgs = ['table', 'set-cell', file, '--section', 'parameters', '--index', '0', '--part', 'body', '--row', '0', '--column', '1', '--text', '420'];
  const bytes = await readFile(file);
  fail(cli([...cellArgs, '--revision', created.revision]), 'NARU_STALE');
  await writeFile(file + '.lock', 'lock'); fail(cli(cellArgs), 'NARU_LOCKED'); ok(cli([...cellArgs, '--dry-run'])); await rm(file + '.lock');
  fail(cli(['batch', file, '--operations', '-', '--revision', saved.nextRevision], JSON.stringify({ schemaVersion: 1, operations: [set(), set('x', { row: 99 })] })), 'NARU_TARGET');
  assert.deepEqual(await readFile(file), bytes);
  ok(cli(cellArgs)); assert.deepEqual(await readFile(file), Buffer.from(bytes.toString().replace('400', '420')));
  assert.equal(ok(cli(cellArgs)).changed, false);
  assert.equal(ok(cli(['validate', file])).valid, true);
  assert.match(ok(cli(['render', file, '--to', 'html'])).html, /<td>420<\/td>/);
  const empty = join(dir, 'empty.narudoc'); ok(cli(['new', empty, '--id', 'parameters']));
  const rev = ok(cli(['inspect', empty])).revision;
  ok(cli(['batch', empty, '--operations', '-', '--revision', rev], JSON.stringify({ schemaVersion: 1, operations: [insert, set()] })));
  assert.equal(ok(cli(['table', 'get', '-', '--section', 'parameters', '--index', '0'], await readFile(empty))).node.rows.length, 2);
});
test('table growth beyond file size limit preserves source on dry-run and save', async t => {
  const dir = await temporary(t), file = join(dir, 'large.narudoc');
  const prefix = '# Parameters {#parameters}\n\n| A |\n| --- |\n| x |\n\n';
  const source = prefix + 'a'.repeat(10 * 1024 * 1024 - prefix.length); await writeFile(file, source);
  for (const suffix of [[], ['--dry-run']]) {
    fail(cli(['table', 'set-cell', file, '--section', 'parameters', '--index', '0', '--part', 'body', '--row', '0', '--column', '0', '--text', 'longer', ...suffix]), 'NARU_LIMIT');
    assert.deepEqual(await readFile(file), Buffer.from(source));
  }
});
