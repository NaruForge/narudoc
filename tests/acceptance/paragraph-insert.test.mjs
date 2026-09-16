import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { parseDocument, planOperation, planBatch, validateDocument, getSection } from '../../packages/core/dist/index.js';
import { renderHtml } from '../../packages/renderer-html/dist/index.js';

const op = (text = 'New **paragraph** 😀 [self](#root).', index = 0, id = 'root') => ({ type: 'insertParagraph', id, index, text });
const insert = (source, operation = op()) => planOperation(parseDocument(source), operation);
for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) for (const final of ['', eol]) {
  test(`empty section insertion preserves encoding and EOF ${JSON.stringify({ eol, bom, final })}`, () => {
    const source = bom + '# Root {#root}' + final;
    const text = '한글 😀 **new**\n[Self](#root).';
    const plan = insert(source, op(text));
    // A heading with no newline uses the document's default LF.
    const expectedEol = final ? eol : '\n';
    assert.equal(plan.next.source, bom + '# Root {#root}' + expectedEol.repeat(2) + text.replaceAll('\n', expectedEol) + final);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.edits[0].start, plan.edits[0].end);
    assert.equal(plan.edits[0].expected, '');
    assert.deepEqual(validateDocument(plan.next), []);
    assert.match(renderHtml(plan.next), /<strong>new<\/strong>/);
  });
}
test('before, between and append positions preserve all other blocks and source', () => {
  const source = '# Root {#root}\n\n- Leading list\n\nFirst.\n \t\n~~~text\n# literal\n~~~\n\nSecond.\n\n:::note\nid: note\n\nDirective body.\n:::\n \t\n## Child {#child}\n\nChild body.\n\n# Next {#next}\n';
  const expected = [
    source.replace('First.', 'Added.\n\nFirst.'),
    source.replace('Second.', 'Added.\n\nSecond.'),
    source.replace(':::\n \t\n## Child', ':::\n\nAdded.\n \t\n## Child'),
  ];
  for (let index = 0; index <= 2; index++) {
    const plan = insert(source, op('Added.', index));
    assert.equal(plan.next.source, expected[index]);
    const edit = plan.edits[0];
    assert.equal(plan.next.source.slice(0, edit.start) + plan.next.source.slice(edit.start + edit.text.length), source);
    assert.deepEqual(plan.next.blocks.map(b => b.type), parseDocument(expected[index]).blocks.map(b => b.type));
    const child = getSection(plan.next, 'child');
    assert.equal(plan.next.source.slice(child.start, child.end), '## Child {#child}\n\nChild body.\n\n');
  }
});
test('paragraph-free body appends after code/list/directive and before a child heading', () => {
  for (const body of ['', '- item\n', '~~~\ncode\n~~~\n', ':::x\nid: D\n\nInside\n:::\n']) {
    const source = '# Root {#root}\n' + body + '## Child {#child}\nChild';
    const end = source.indexOf('\n## Child') >= 0 ? source.indexOf('\n## Child') : '# Root {#root}'.length;
    const expected = source.slice(0, end) + '\n\nAdded.\n' + source.slice(end);
    assert.equal(insert(source, op('Added.')).next.source, expected);
  }
});
test('mixed CR/LF gaps count after concatenation and keep neighboring paragraphs separate', () => {
  for (const first of ['\n', '\r', '\r\n']) for (const gap of ['\n\n', '\r\r', '\r\n\r\n', '\n \t\r', '\r\n\n']) {
    const source = '# Root {#root}' + first + 'Before' + gap + 'After';
    const plan = insert(source, op('New', 1));
    assert.deepEqual(plan.next.blocks.filter(b => b.type === 'paragraph').map(b => plan.next.source.slice(b.range.start, b.range.end)), ['Before', 'New', 'After']);
    const edit = plan.edits[0];
    assert.equal(plan.next.source.slice(0, edit.start) + plan.next.source.slice(edit.start + edit.text.length), source);
  }
  // CR document + LF before heading: a new CR and existing LF coalesce.
  const source = '# Root {#root}\rOld\n## Child {#child}';
  assert.equal(insert(source, op('New', 1)).next.source, '# Root {#root}\rOld\r\rNew\r\r\n## Child {#child}');
});
test('insertion preserves whitespace-only trailing lines and repeated insertions add paragraphs', () => {
  const source = '# Root {#root}\n\nOld\n \t\n  ';
  const first = insert(source, op('New', 1));
  assert.equal(first.next.source, '# Root {#root}\n\nOld\n\nNew\n \t\n  ');
  const second = planOperation(first.next, op('New', 1));
  assert.equal(second.next.blocks.filter(b => b.type === 'paragraph').length, 3);
  assert.equal(second.next.source, '# Root {#root}\n\nOld\n\nNew\n\nNew\n \t\n  ');
});
test('invalid targets, positions, structural input and references fail without mutation', () => {
  const source = '# Root {#root}\n\n:::note\nid: D\n\nBody\n:::\n\n## Child {#child}\n\nChild';
  const doc = parseDocument(source);
  for (const index of [-1, 0.5, 1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => planOperation(doc, op('New', index)), e => e.code === 'NARU_TARGET');
  for (const id of ['missing', 'D']) assert.throws(() => planOperation(doc, op('New', 0, id)), e => e.code === 'NARU_TARGET');
  for (const text of ['', ' ', '\nNew', 'New\n', 'One\n\nTwo', '# Heading', 'One\n## Heading', '- list', '~~~\ncode\n~~~', ':::x\n:::', ':::', '---\na: b\n---', '\uFEFFText', '\ud800', '\0']) {
    assert.throws(() => planOperation(doc, op(text)), e => e.code === 'NARU_ARGUMENT', JSON.stringify(text));
  }
  assert.throws(() => planOperation(doc, op('[bad](#missing)')), e => e.code === 'NARU_INVALID_DOCUMENT');
  assert.throws(() => insert('# Root {#root}\n\n[bad](#missing)'), e => e.code === 'NARU_INVALID_DOCUMENT');
  assert.equal(doc.source, source);
});
test('batch indexes evolving paragraphs and later failure reports its step', () => {
  const doc = parseDocument('# Root {#root}\n');
  const request = { schemaVersion: 1, operations: [op('First'), op('Second', 1), { type: 'replaceParagraph', id: 'root', index: 0, text: 'Changed' }] };
  assert.equal(planBatch(doc, request).next.source, '# Root {#root}\n\nChanged\n\nSecond\n');
  assert.throws(() => planBatch(doc, { ...request, operations: [...request.operations, op('Bad', 3)] }), e => e.code === 'NARU_TARGET' && e.operationIndex === 3);
  for (const operation of [{ ...op(), extra: true }, { ...op(), index: '0' }, { ...op(), text: null }]) {
    assert.throws(() => planBatch(doc, { schemaVersion: 1, operations: [operation] }), e => e.code === 'NARU_ARGUMENT' && e.operationIndex === 0);
  }
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = join(root, '.narudoc-scenarios');
const cli = (args, input) => spawnSync(process.execPath, [join(root, 'apps/cli/bin/narudoc.mjs'), ...args, '--json'], { encoding: 'utf8', input, timeout: 20000 });
const ok = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); };
const failure = (result, status, code, index) => {
  assert.equal(result.status, status, result.stderr); assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, code); assert.equal(error.operationIndex, index);
};
async function temporary(t) {
  await mkdir(outputRoot, { recursive: true });
  const dir = await mkdtemp(join(outputRoot, 'paragraph-insert-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
test('CLI new → insert → replace → validate → HTML; failures and batch rollback preserve file', async t => {
  const dir = await temporary(t), file = join(dir, 'new.narudoc');
  const created = ok(cli(['new', file, '--title', 'Root', '--id', 'root']));
  const source = await readFile(file), before = await stat(file);
  const args = ['paragraph', 'insert', file, '--id', 'root', '--index', '0', '--text', 'New **text** [root](#root).'];
  const unchanged = async () => { assert.deepEqual(await readFile(file), source); assert.equal((await stat(file)).mtimeMs, before.mtimeMs); };
  const preview = ok(cli([...args, '--revision', created.revision, '--dry-run'])); await unchanged();
  failure(cli([...args, '--revision', '0'.repeat(64)]), 4, 'NARU_STALE'); await unchanged();
  for (const [id, index, text, code, status] of [['missing', '0', 'New', 'NARU_TARGET', 2], ['root', '1', 'New', 'NARU_TARGET', 2], ['root', '-1', 'New', 'NARU_ARGUMENT', 2], ['root', '0', '# Inject', 'NARU_ARGUMENT', 2], ['root', '0', '[bad](#bad)', 'NARU_INVALID_DOCUMENT', 3]]) {
    failure(cli(['paragraph', 'insert', file, '--id', id, '--index', index, '--text', text]), status, code); await unchanged();
  }
  await writeFile(file + '.lock', 'existing lock');
  failure(cli(args), 4, 'NARU_LOCKED'); await unchanged();
  assert.equal(await readFile(file + '.lock', 'utf8'), 'existing lock'); await rm(file + '.lock');
  const batchArgs = ['batch', file, '--operations', '-', '--revision', created.revision];
  failure(cli(batchArgs, JSON.stringify({ schemaVersion: 1, operations: [op('First'), { type: 'removeSection', id: 'missing' }] })), 2, 'NARU_TARGET', 1); await unchanged();
  const saved = ok(cli([...args, '--revision', created.revision]));
  assert.deepEqual(saved.edits, preview.edits); assert.equal(saved.nextRevision, preview.nextRevision);
  assert.equal(await readFile(file, 'utf8'), '# Root {#root}\n\nNew **text** [root](#root).\n');
  ok(cli(['paragraph', 'replace', file, '--id', 'root', '--index', '0', '--text', 'Changed **text**.', '--revision', saved.nextRevision]));
  assert.equal(ok(cli(['validate', file])).valid, true);
  assert.match(ok(cli(['render', file, '--to', 'html'])).html, /<p>Changed <strong>text<\/strong>\.<\/p>/);
  const batchFile = join(dir, 'batch.narudoc');
  await writeFile(batchFile, '\uFEFF# Root {#root}\r\n');
  const batchSource = await readFile(batchFile), revision = ok(cli(['inspect', batchFile])).revision;
  const command = ['batch', batchFile, '--operations', '-', '--revision', revision];
  const input = JSON.stringify({ schemaVersion: 1, operations: [op('First'), op('Second', 1)] });
  const batchPreview = ok(cli([...command, '--dry-run'], input)); assert.deepEqual(await readFile(batchFile), batchSource);
  const batchSaved = ok(cli(command, input)); assert.deepEqual(batchSaved.steps, batchPreview.steps);
  assert.equal(batchSaved.nextRevision, batchPreview.nextRevision);
  assert.deepEqual(await readFile(batchFile), Buffer.from('\uFEFF# Root {#root}\r\n\r\nFirst\r\n\r\nSecond\r\n'));
});
test('over-limit insertion fails in dry-run and save before touching the source', async t => {
  const dir = await temporary(t), file = join(dir, 'large.narudoc');
  const prefix = '# Root {#root}\n\n';
  const source = prefix + 'a'.repeat(10 * 1024 * 1024 - Buffer.byteLength(prefix));
  await writeFile(file, source);
  const args = ['paragraph', 'insert', file, '--id', 'root', '--index', '1', '--text', 'New'];
  for (const suffix of [[], ['--dry-run']]) {
    failure(cli([...args, ...suffix]), 5, 'NARU_LIMIT');
    assert.deepEqual(await readFile(file), Buffer.from(source));
  }
});
