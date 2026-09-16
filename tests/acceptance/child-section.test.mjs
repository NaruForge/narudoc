import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { parseDocument, planOperation, planBatch, outline, getSection, validateDocument } from '../../packages/core/dist/index.js';
const op = (parent = 'root', id = 'new', title = 'New 😀') => ({ type: 'insertChildSection', parent, id, title });
const source = '# Root {#root}\n\nRoot text.\n\n## Old {#old}\n\n- Keep   list\n\n### Deep {#deep}\n\n~~~\n# Not a heading\n~~~\n\n:::note\nid: N\n\nKeep body.\n:::\n \t\n# Next {#next}\n';
for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) test(`last child preserves descendant slices ${JSON.stringify({eol,bom})}`, () => {
  const before = bom + source.replaceAll('\n', eol), doc = parseDocument(before);
  const plan = planOperation(doc, op());
  assert.equal(plan.next.source, bom + source.replace(':::\n \t\n# Next', ':::\n\n## New 😀 {#new}\n \t\n# Next').replaceAll('\n', eol));
  assert.deepEqual(outline(plan.next).map(s => [s.id, s.level]), [['root', 1], ['old', 2], ['deep', 3], ['new', 2], ['next', 1]]);
  assert.equal(getSection(plan.next, 'new').parentStart, getSection(plan.next, 'root').start);
  const edit = plan.edits[0]; assert.equal(edit.start, edit.end); assert.equal(edit.expected, '');
  assert.equal(plan.next.source.slice(0, edit.start) + plan.next.source.slice(edit.start + edit.text.length), before);
  assert.deepEqual(validateDocument(plan.next), []);
});
test('empty parents level 1 through 5, EOF and mixed boundary line endings', () => {
  for (let level = 1; level <= 5; level++) for (const tail of ['', '\n', '\r\n', '\r \t\n']) {
    const before = '#'.repeat(level) + ' Parent {#root}' + tail;
    const doc = parseDocument(before), plan = planOperation(doc, op());
    assert.equal(plan.next.source, '#'.repeat(level) + ' Parent {#root}' + doc.eol.repeat(2) + '#'.repeat(level + 1) + ' New 😀 {#new}' + tail);
    assert.equal(getSection(plan.next, 'new').parentStart, 0);
  }
  const mixed = '# Root {#root}\rOld\n# Next {#next}';
  assert.equal(planOperation(parseDocument(mixed), op()).next.source, '# Root {#root}\rOld\r\r## New 😀 {#new}\r\r\n# Next {#next}');
  // Parent with skipped-level descendants still receives a direct child, without rewriting them.
  const skipped = '# Root {#root}\n### Deep {#deep}';
  const plan = planOperation(parseDocument(skipped), op());
  assert.equal(plan.next.source, skipped + '\n\n## New 😀 {#new}');
  assert.equal(getSection(plan.next, 'new').parentStart, 0);
});
test('invalid parent, duplicate ID, level, title and references fail without mutation', () => {
  const doc = parseDocument(source);
  for (const parent of ['missing', 'N']) assert.throws(() => planOperation(doc, op(parent)), e => e.code === 'NARU_TARGET');
  for (const id of ['root', 'N', '1bad', 'bad id', '']) assert.throws(() => planOperation(doc, op('root', id)), e => e.code === 'NARU_ARGUMENT');
  for (const title of ['', ' ', 'x\n# injected', 'x {#extra}', 'x ###', '\ud800']) assert.throws(() => planOperation(doc, op('root', 'new', title)), e => e.code === 'NARU_ARGUMENT');
  assert.throws(() => planOperation(parseDocument('###### Six {#six}'), op('six')), e => e.code === 'NARU_ARGUMENT');
  assert.throws(() => planOperation(doc, op('root', 'new', '[missing](#missing)')), e => e.code === 'NARU_INVALID_DOCUMENT');
  assert.throws(() => planOperation(parseDocument('# Root {#root}\n[bad](#missing)'), op()), e => e.code === 'NARU_INVALID_DOCUMENT');
  assert.equal(doc.source, source);
  assert.throws(() => planBatch(doc, { schemaVersion: 1, operations: [{ ...op(), after: 'old' }] }), e => e.code === 'NARU_ARGUMENT' && e.operationIndex === 0);
});
const root = fileURLToPath(new URL('../../', import.meta.url)), outputRoot = join(root, '.narudoc-scenarios');
const cli = (args, input) => spawnSync(process.execPath, [join(root, 'apps/cli/bin/narudoc.mjs'), ...args, '--json'], { encoding: 'utf8', input, timeout: 20000 });
const ok = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return JSON.parse(r.stdout); };
const fail = (r, status, code, index) => { assert.equal(r.status, status, r.stderr); assert.equal(r.stdout, ''); const e = JSON.parse(r.stderr).error; assert.equal(e.code, code); assert.equal(e.operationIndex, index); };
async function temporary(t) {
  await mkdir(outputRoot, { recursive: true }); const dir = await mkdtemp(join(outputRoot, 'child-section-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); }); return dir;
}
test('CLI single save, conflict/error preservation and batch hierarchy/requirement authoring', async t => {
  const dir = await temporary(t), file = join(dir, 'document.narudoc');
  await writeFile(file, '\uFEFF' + source.replaceAll('\n', '\r\n'));
  const before = await readFile(file), rev = ok(cli(['inspect', file])).revision;
  const args = ['section', 'insert-child', file, '--parent', 'root', '--id', 'new', '--title', 'New'];
  const unchanged = async () => assert.deepEqual(await readFile(file), before);
  const preview = ok(cli([...args, '--revision', rev, '--dry-run'])); await unchanged();
  fail(cli([...args, '--revision', '0'.repeat(64)]), 4, 'NARU_STALE'); await unchanged();
  fail(cli([...args, '--after', 'old']), 2, 'NARU_ARGUMENT'); await unchanged();
  for (const [parent, id, title, code] of [['missing', 'new', 'New', 'NARU_TARGET'], ['root', 'N', 'New', 'NARU_ARGUMENT'], ['root', 'new', 'X\nY', 'NARU_ARGUMENT']]) {
    fail(cli(['section', 'insert-child', file, '--parent', parent, '--id', id, '--title', title]), 2, code); await unchanged();
  }
  await writeFile(file + '.lock', 'lock'); fail(cli(args), 4, 'NARU_LOCKED'); await unchanged();
  assert.equal(await readFile(file + '.lock', 'utf8'), 'lock'); await rm(file + '.lock');
  fail(cli(['batch', file, '--operations', '-', '--revision', rev], JSON.stringify({ schemaVersion: 1, operations: [op(), { type: 'removeSection', id: 'missing' }] })), 2, 'NARU_TARGET', 1); await unchanged();
  const saved = ok(cli([...args, '--revision', rev])); assert.deepEqual(saved.edits, preview.edits); assert.equal(saved.nextRevision, preview.nextRevision);
  assert.equal(ok(cli(['outline', file])).sections.find(s => s.id === 'new').level, 2);
  const authored = join(dir, 'authored.narudoc'), created = ok(cli(['new', authored, '--id', 'design', '--title', 'Design']));
  const batch = ['batch', authored, '--operations', join(root, 'examples/hierarchy-edit.json'), '--revision', created.revision];
  const dry = ok(cli([...batch, '--dry-run'])); assert.equal(await readFile(authored, 'utf8'), '# Design {#design}\n');
  const done = ok(cli(batch)); assert.deepEqual(done.steps, dry.steps); assert.equal(done.nextRevision, dry.nextRevision);
  assert.deepEqual(ok(cli(['outline', authored])).sections.map(s => [s.id, s.level]), [['design', 1], ['control', 2], ['protection', 3], ['validation', 2]]);
  assert.equal(ok(cli(['get', authored, '--id', 'REQ-001'])).node.name, 'requirement');
  assert.equal(ok(cli(['validate', authored])).valid, true);
  const html = ok(cli(['render', authored, '--to', 'html'])).html;
  assert.match(html, /<h3 id="protection"/); assert.match(html, /href="#validation"/);
});
test('child section growth over document limit rejects dry-run and save', async t => {
  const dir = await temporary(t), file = join(dir, 'large.narudoc'), prefix = '# Root {#root}\n\n';
  const before = prefix + 'x'.repeat(10 * 1024 * 1024 - prefix.length); await writeFile(file, before);
  for (const suffix of [[], ['--dry-run']]) {
    fail(cli(['section', 'insert-child', file, '--parent', 'root', '--id', 'new', '--title', 'New', ...suffix]), 5, 'NARU_LIMIT');
    assert.deepEqual(await readFile(file), Buffer.from(before));
  }
});
