import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { parseDocument, planOperation, planBatch, validateDocument } from '../../packages/core/dist/index.js';
import { renderHtml } from '../../packages/renderer-html/dist/index.js';

const original = 'The controller shall check inputs 😀.';
const replacement = 'The controller shall check **all** inputs 😀.\nSee [design](#design).';
function document(text = original) {
  return `# Design {#design}\n\nOutside paragraph.\n\n:::requirement\nid: REQ-001\nstatus : draft  \n\nFirst paragraph.  \n\n- Keep this list\n\n~~~text\n:::literal\n[code](#missing)\n~~~\n\n${text}\n\nLast paragraph.\n:::\n\n:::unknown\nid: OTHER\n\nOther body.\n:::`;
}
const operation = (text = replacement, index = 1, id = 'REQ-001') => ({ type: 'replaceDirectiveParagraph', id, index, text });
for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) {
  test(`directive paragraph preserves bytes and UTF-16 ranges ${JSON.stringify({ eol, bom })}`, () => {
    const source = bom + document().replaceAll('\n', eol);
    const doc = parseDocument(source), plan = planOperation(doc, operation());
    assert.deepEqual(Buffer.from(plan.next.source), Buffer.from(bom + document(replacement).replaceAll('\n', eol)));
    assert.deepEqual(validateDocument(plan.next), []);
    const target = doc.blocks.find(b => b.type === 'directive').children[3];
    for (const edit of plan.edits) {
      assert.ok(edit.start >= target.range.start && edit.end <= target.range.end);
      assert.equal(source.slice(edit.start, edit.end), edit.expected);
    }
    assert.equal(doc.source, source);
    assert.deepEqual(planOperation(doc, operation(original)).edits, []);
    assert.deepEqual(planOperation(plan.next, operation(replacement)).edits, []);
    const html = renderHtml(plan.next);
    assert.match(html, /check <strong>all<\/strong> inputs 😀/);
    assert.match(html, /href="#design"/);
    assert.match(html, /\[code\]\(#missing\)/);
  });
}
test('exact mixed-ending no-op and generic directive targets', () => {
  const text = 'One\r\nTwo\nThree\rFour';
  const source = document(text), doc = parseDocument(source);
  const plan = planOperation(doc, operation(text));
  assert.deepEqual(plan.edits, []);
  assert.equal(plan.next.source, source);
  assert.equal(planOperation(doc, operation('Changed generic.', 0, 'OTHER')).next.source, source.replace('Other body.', 'Changed generic.'));
});
test('directive-context literal headings and metadata remain one paragraph', () => {
  const text = '# Literal {#not-a-target}\n---\nid: literal\n---';
  const next = planOperation(parseDocument(document()), operation(text)).next;
  const children = next.blocks.find(b => b.type === 'directive').children;
  assert.deepEqual(children.map(b => b.type), ['paragraph', 'list', 'code', 'paragraph', 'paragraph']);
  assert.equal(next.source.slice(children[3].range.start, children[3].range.end), text);
  assert.equal(next.blocks.filter(b => b.type === 'heading').length, 1);
});
test('reject structural injection, malformed input, broken references and bad targets', () => {
  const doc = parseDocument(document());
  for (const text of ['', ' ', '\nText', 'Text\n', 'One\n\nTwo', '- item', 'Text\n- item',
    '```\ncode\n```', '~~~\ncode', ':::', 'Text\n:::\n\nOutside\n\n:::other\n\nBody',
    ':::nested', 'Text\n:::nested', '\0', '\ud800']) {
    assert.throws(() => planOperation(doc, operation(text)), e => e.code === 'NARU_ARGUMENT', JSON.stringify(text));
  }
  assert.throws(() => planOperation(doc, operation('[bad](#missing)')), e => e.code === 'NARU_INVALID_DOCUMENT');
  for (const index of [-1, 0.5, 3, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planOperation(doc, operation('text', index)), e => e.code === 'NARU_TARGET');
  }
  for (const id of ['missing', 'design']) assert.throws(() => planOperation(doc, operation('text', 0, id)), e => e.code === 'NARU_TARGET');
  assert.throws(() => planOperation(parseDocument(':::x\nid: E\n:::'), operation('text', 0, 'E')), e => e.code === 'NARU_TARGET');
  // Section paragraph indexing is unchanged and does not count directive children.
  assert.throws(() => planOperation(doc, { type: 'replaceParagraph', id: 'design', index: 1, text: 'text' }), e => e.code === 'NARU_TARGET');
  assert.equal(doc.source, document());
});
test('batch reparses after rename and preserves operation failure index', () => {
  const doc = parseDocument(document());
  const request = { schemaVersion: 1, operations: [
    { type: 'renameId', id: 'REQ-001', newId: 'REQ-LONG-001' },
    operation(replacement, 1, 'REQ-LONG-001'),
  ] };
  assert.equal(planBatch(doc, request).next.source, document(replacement).replace('id: REQ-001', 'id: REQ-LONG-001'));
  assert.throws(() => planBatch(doc, { ...request, operations: [...request.operations, operation('bad', 99, 'REQ-LONG-001')] }), e => e.code === 'NARU_TARGET' && e.operationIndex === 2);
  assert.throws(() => planBatch(doc, { schemaVersion: 1, operations: [{ ...operation(), extra: true }] }), e => e.code === 'NARU_ARGUMENT' && e.operationIndex === 0);
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = join(root, '.narudoc-scenarios');
const cli = (args, input) => spawnSync(process.execPath, [join(root, 'apps/cli/bin/narudoc.mjs'), ...args, '--json'], { encoding: 'utf8', input, timeout: 15000 });
const ok = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); };
const failure = (result, status, code, index) => {
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, code); assert.equal(error.operationIndex, index);
};
test('CLI requirement editing: lookup, dry-run, conflicts, save, no-op, batch rollback and HTML', async t => {
  await mkdir(outputRoot, { recursive: true });
  const dir = await mkdtemp(join(outputRoot, 'directive-edit-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, 'document.narudoc');
  const source = '\uFEFF' + document().replaceAll('\n', '\r\n');
  await writeFile(file, source);
  const revision = ok(cli(['get', file, '--id', 'REQ-001'])).revision;
  const args = ['directive', 'replace-paragraph', file, '--id', 'REQ-001', '--index', '1'];
  const unchanged = async () => assert.deepEqual(await readFile(file), Buffer.from(source));
  const preview = ok(cli([...args, '--text', replacement, '--revision', revision, '--dry-run'])); await unchanged();
  for (const [text, status, code] of [[':::', 2, 'NARU_ARGUMENT'], ['[bad](#missing)', 3, 'NARU_INVALID_DOCUMENT']]) {
    failure(cli([...args, '--text', text]), status, code); await unchanged();
  }
  failure(cli([...args, '--text', replacement, '--revision', '0'.repeat(64)]), 4, 'NARU_STALE'); await unchanged();
  failure(cli(['directive', 'replace-paragraph', file, '--id', 'missing', '--index', '0', '--text', 'text']), 2, 'NARU_TARGET'); await unchanged();
  await writeFile(file + '.lock', 'existing lock');
  failure(cli([...args, '--text', replacement]), 4, 'NARU_LOCKED'); await unchanged();
  assert.equal(await readFile(file + '.lock', 'utf8'), 'existing lock');
  await rm(file + '.lock');
  const batchArgs = ['batch', file, '--operations', '-', '--revision', revision];
  const request = { schemaVersion: 1, operations: [operation(), { type: 'removeSection', id: 'missing' }] };
  failure(cli(batchArgs, JSON.stringify(request)), 2, 'NARU_TARGET', 1); await unchanged();
  const saved = ok(cli([...args, '--text', replacement, '--revision', revision]));
  assert.deepEqual(saved.edits, preview.edits); assert.equal(saved.nextRevision, preview.nextRevision);
  const expected = '\uFEFF' + document(replacement).replaceAll('\n', '\r\n');
  assert.deepEqual(await readFile(file), Buffer.from(expected));
  const noop = ok(cli([...args, '--text', replacement, '--revision', saved.nextRevision]));
  assert.equal(noop.changed, false); assert.deepEqual(noop.edits, []);
  assert.deepEqual(await readFile(file), Buffer.from(expected));
  assert.equal(ok(cli(['validate', file])).valid, true);
  assert.match(ok(cli(['render', file, '--to', 'html'])).html, /check <strong>all<\/strong> inputs 😀/);
  await writeFile(file, source);
  const input = JSON.stringify({ schemaVersion: 1, operations: [operation()] });
  const batchPreview = ok(cli([...batchArgs, '--dry-run'], input)); await unchanged();
  const batchSaved = ok(cli(batchArgs, input));
  assert.deepEqual(batchSaved.steps, batchPreview.steps);
  assert.equal(batchSaved.nextRevision, saved.nextRevision);
  assert.deepEqual(await readFile(file), Buffer.from(expected));
});
