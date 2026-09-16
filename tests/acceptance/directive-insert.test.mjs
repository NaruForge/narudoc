import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { parseDocument, planOperation, planBatch, validateDocument, getById, readDirectiveInput } from '../../packages/core/dist/index.js';
import { renderHtml } from '../../packages/renderer-html/dist/index.js';
import { parseJsonInput } from '../../apps/cli/dist/json.js';

const input = () => ({ name: 'requirement', id: 'REQ-001', attributes: { status: 'draft', note: '' }, children: [
  { type: 'paragraph', text: '한글 😀 **[self](#REQ-001)** and [root](#root).' },
  { type: 'list', ordered: false, items: ['[self](#REQ-001)', '<script>bad</script>'] },
  { type: 'list', ordered: true, start: 3, items: ['First', 'Second'] },
  { type: 'code', language: 'text', value: '[fake](#missing)\n:::nested\n```\n````\n' },
] });
const operation = (value = input(), sectionId = 'root') => ({ type: 'insertDirective', sectionId, ...value });
const base = '# Root {#root}\n\nOld   paragraph.\n\n- Old list\n\n~~~\nOld code\n~~~\n\n:::note\nid: OLD\n\nOld body.\n:::\n \t\n## Child {#child}\n\nChild.\n\n# Next {#next}';
const generated = ':::requirement\nid: REQ-001\nstatus: draft\nnote: \n\n한글 😀 **[self](#REQ-001)** and [root](#root).\n\n- [self](#REQ-001)\n- <script>bad</script>\n\n3. First\n4. Second\n\n`````text\n[fake](#missing)\n:::nested\n```\n````\n`````\n:::';
for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) test(`structured creation and exact source preservation ${JSON.stringify({eol, bom})}`, () => {
  const source = bom + base.replaceAll('\n', eol), doc = parseDocument(source);
  const plan = planOperation(doc, operation());
  const expected = bom + base.replace(':::\n \t\n## Child', ':::\n\n' + generated + '\n \t\n## Child').replaceAll('\n', eol);
  assert.deepEqual(Buffer.from(plan.next.source), Buffer.from(expected));
  assert.deepEqual(validateDocument(plan.next), []);
  assert.equal(plan.edits.length, 1);
  const edit = plan.edits[0];
  assert.equal(edit.start, edit.end); assert.equal(edit.expected, '');
  assert.equal(plan.next.source.slice(0, edit.start) + plan.next.source.slice(edit.start + edit.text.length), source);
  const node = getById(plan.next, 'REQ-001');
  assert.deepEqual(node.children.map(c => c.type), ['paragraph', 'list', 'list', 'code']);
  assert.equal(plan.next.source.slice(node.range.start, node.range.end), generated.replaceAll('\n', eol));
  for (const child of node.children) assert.ok(child.range.start > node.range.start && child.range.end < node.range.end);
  const link = node.children[0].inline.find(n => n.type === 'strong').children[0];
  assert.equal(plan.next.source.slice(link.urlRange.start, link.urlRange.end), '#REQ-001');
  assert.equal(node.children[3].value, input().children[3].value.replaceAll('\n', eol));
  assert.equal(doc.source, source);
});
test('empty, generic, paragraph, list and code bodies retain EOF and mixed whitespace', () => {
  for (const source of ['# Root {#root}', '\uFEFF# Root {#root}\r\n', '# Root {#root}\n\nOld\r \t\r\n', '# Root {#root}\rOld\n## Child {#child}']) {
    for (const children of [[], [{ type: 'paragraph', text: '# literal\n---\nid: literal\n---' }], [{ type: 'list', ordered: true, items: ['one'] }], [{ type: 'code', value: '' }], [{ type: 'code', value: 'unterminated\r\n```\r~~~' }]]) {
      const plan = planOperation(parseDocument(source), operation({ name: 'unknown', id: 'D', attributes: {}, children }));
      const edit = plan.edits[0];
      assert.equal(plan.next.source.slice(0, edit.start) + plan.next.source.slice(edit.start + edit.text.length), source);
      assert.equal(getById(plan.next, 'D').children.length, children.length);
      assert.deepEqual(validateDocument(plan.next), []);
      assert.equal(/[\r\n]$/.test(plan.next.source), /[\r\n]$/.test(source));
    }
  }
});
test('new directive supports set, paragraph edit, rename and safe HTML in one batch', () => {
  const value = input();
  value.children.push({ type: 'paragraph', text: '<script>x</script> [bad](javascript:evil)' });
  const doc = parseDocument('# Root {#root}\n');
  const request = { schemaVersion: 1, operations: [operation(value),
    { type: 'setDirectiveAttribute', id: 'REQ-001', key: 'status', value: 'reviewed' },
    { type: 'replaceDirectiveParagraph', id: 'REQ-001', index: 0, text: 'Changed 😀 [self](#REQ-001)' },
    { type: 'renameId', id: 'REQ-001', newId: 'REQ-NEW' },
  ] };
  const plan = planBatch(doc, request), node = getById(plan.next, 'REQ-NEW');
  assert.equal(node.attributes.find(a => a.key === 'status').value, 'reviewed');
  assert.match(plan.next.source, /Changed 😀 \[self\]\(#REQ-NEW\)/);
  assert.match(plan.next.source, /- \[self\]\(#REQ-NEW\)/);
  assert.match(plan.next.source, /\[fake\]\(#missing\)/);
  const html = renderHtml(plan.next);
  assert.match(html, /id="REQ-NEW"/); assert.match(html, /href="#REQ-NEW"/);
  assert.match(html, /<ol start="3">/); assert.match(html, /<pre><code>/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.throws(() => planBatch(doc, { ...request, operations: [...request.operations, { type: 'removeSection', id: 'missing' }] }), e => e.code === 'NARU_TARGET' && e.operationIndex === 4);
});
test('strict DTO validation rejects unknown fields, invalid values and child injection', () => {
  const doc = parseDocument('# Root {#root}\n');
  const bad = [
    null, {}, { ...input(), extra: true }, { ...input(), name: 'bad\nname' }, { ...input(), id: '1bad' },
    { ...input(), attributes: { id: 'duplicate' } }, { ...input(), attributes: JSON.parse('{"__proto__":"x"}') },
    { ...input(), attributes: { constructor: 'x' } }, { ...input(), attributes: { bad: 1 } },
    { ...input(), attributes: { note: ' padded ' } }, { ...input(), attributes: { note: 'a\n:::' } },
    { ...input(), attributes: [] }, { ...input(), children: {} },
  ];
  for (const child of [null, { type: 'unknown' }, { type: 'paragraph', text: 'x', range: {} },
    { type: 'paragraph', text: '\ud800' }, { type: 'paragraph', text: '\0' },
    { type: 'list', ordered: false, items: [] }, { type: 'list', ordered: 'yes', items: ['x'] },
    { type: 'list', ordered: false, start: 1, items: ['x'] }, { type: 'list', ordered: true, start: -1, items: ['x'] },
    { type: 'list', ordered: true, start: 999999999, items: ['x', 'y'] },
    { type: 'list', ordered: false, items: ['x\n- injected'] }, { type: 'list', ordered: false, items: [''] },
    { type: 'code', value: 3 }, { type: 'code', value: 'x', language: '`bad' }, { type: 'code', value: 'x', language: 'x\n:::' },
  ]) bad.push({ ...input(), children: [child] });
  for (const value of bad) assert.throws(() => readDirectiveInput(value), e => e.code === 'NARU_ARGUMENT', JSON.stringify(value));
  for (const text of ['', ' ', 'x\n', '\nx', 'x\n\ny', '- item', '```\nx\n```', ':::', 'x\n:::\n\n:::other\n\ny']) {
    assert.throws(() => planOperation(doc, operation({ ...input(), children: [{ type: 'paragraph', text }] })), e => e.code === 'NARU_ARGUMENT', text);
  }
  assert.throws(() => planOperation(doc, { ...operation(), extra: 1 }), e => e.code === 'NARU_ARGUMENT');
  assert.throws(() => planOperation(doc, operation(input(), 'missing')), e => e.code === 'NARU_TARGET');
  assert.throws(() => planOperation(doc, operation({ ...input(), id: 'root' })), e => e.code === 'NARU_ARGUMENT');
  assert.throws(() => planOperation(doc, operation({ ...input(), children: [{ type: 'paragraph', text: '[bad](#missing)' }] })), e => e.code === 'NARU_INVALID_DOCUMENT');
  assert.equal(doc.source, '# Root {#root}\n');
});
test('JSON duplicate detection distinguishes nested keys, escapes and punctuation in strings', () => {
  for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"attributes":{"x":"1","x":"2"}}', '[{"x":1,"x":2}]']) assert.throws(() => parseJsonInput(source), e => e.code === 'NARU_ARGUMENT');
  for (const source of ['{"a":{"x":1},"b":{"x":2}}', '{"text":"\\\"a\\\":{},[]","x":2}', '["x",{"x":1}]', '0', 'null']) assert.deepEqual(parseJsonInput('\uFEFF' + source), JSON.parse(source));
});

const root = fileURLToPath(new URL('../../', import.meta.url)), outputRoot = join(root, '.narudoc-scenarios');
const cli = (args, input) => spawnSync(process.execPath, [join(root, 'apps/cli/bin/narudoc.mjs'), ...args, '--json'], { encoding: 'utf8', input, timeout: 20000 });
const ok = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return JSON.parse(r.stdout); };
const fails = (r, status, code, index) => { assert.equal(r.status, status, r.stderr); assert.equal(r.stdout, ''); const e = JSON.parse(r.stderr).error; assert.equal(e.code, code); assert.equal(e.operationIndex, index); };
async function temporary(t) {
  await mkdir(outputRoot, { recursive: true }); const dir = await mkdtemp(join(outputRoot, 'directive-insert-'));
  t.after(async () => { assert.ok(dir.startsWith(outputRoot + sep)); await rm(dir, { recursive: true, force: true }); }); return dir;
}
test('CLI JSON file/stdin, follow-up edits, failures, byte preservation and batch rollback', async t => {
  const dir = await temporary(t), file = join(dir, 'doc.narudoc'), jsonFile = join(dir, 'input.json');
  const source = '\uFEFF' + base.replaceAll('\n', '\r\n'); await writeFile(file, source);
  await writeFile(jsonFile, '\uFEFF' + JSON.stringify(input()));
  const before = await stat(file), revision = ok(cli(['inspect', file])).revision;
  const args = ['directive', 'insert', file, '--section', 'root', '--from', jsonFile, '--revision', revision];
  const unchanged = async () => { assert.deepEqual(await readFile(file), Buffer.from(source)); assert.equal((await stat(file)).mtimeMs, before.mtimeMs); };
  const preview = ok(cli([...args, '--dry-run'])); await unchanged();
  const stdinArgs = ['directive', 'insert', file, '--section', 'root', '--from', '-'];
  fails(cli([...stdinArgs, '--revision', '0'.repeat(64)], JSON.stringify(input())), 4, 'NARU_STALE'); await unchanged();
  for (const raw of ['{', '{"name":"x","name":"y"}', JSON.stringify({ ...input(), extra: 1 }), JSON.stringify(input()).replace('"status":"draft"', '"status":"draft","status":"other"')]) {
    fails(cli(stdinArgs, raw), 2, 'NARU_ARGUMENT'); await unchanged();
  }
  fails(cli(stdinArgs, Buffer.from([0xc3, 0x28])), 3, 'NARU_ENCODING'); await unchanged();
  fails(cli(stdinArgs, ' '.repeat(10 * 1024 * 1024 + 1)), 5, 'NARU_LIMIT'); await unchanged();
  fails(cli(stdinArgs, JSON.stringify({ ...input(), id: 'root' })), 2, 'NARU_ARGUMENT'); await unchanged();
  fails(cli(stdinArgs, JSON.stringify({ ...input(), children: [{ type: 'paragraph', text: '[bad](#missing)' }] })), 3, 'NARU_INVALID_DOCUMENT'); await unchanged();
  await writeFile(file + '.lock', 'lock'); fails(cli(args), 4, 'NARU_LOCKED'); await unchanged();
  assert.equal(await readFile(file + '.lock', 'utf8'), 'lock'); await rm(file + '.lock');
  const batchArgs = ['batch', file, '--operations', '-', '--revision', revision];
  fails(cli(batchArgs, JSON.stringify({ schemaVersion: 1, operations: [operation(), { type: 'removeSection', id: 'missing' }] })), 2, 'NARU_TARGET', 1); await unchanged();
  fails(cli(batchArgs, JSON.stringify({ schemaVersion: 1, operations: [operation()] }).replace('"status":"draft"', '"status":"draft","status":"x"')), 2, 'NARU_ARGUMENT'); await unchanged();
  const saved = ok(cli(args)); assert.deepEqual(saved.edits, preview.edits); assert.equal(saved.nextRevision, preview.nextRevision);
  assert.equal(ok(cli(['get', file, '--id', 'REQ-001'])).node.children.length, 4);
  assert.equal(ok(cli(['inspect', file])).blocks.filter(b => b.type === 'directive').length, 2);
  ok(cli(['directive', 'set', file, '--id', 'REQ-001', '--key', 'status', '--value', 'reviewed']));
  ok(cli(['directive', 'replace-paragraph', file, '--id', 'REQ-001', '--index', '0', '--text', 'Changed [self](#REQ-001)']));
  ok(cli(['id', 'rename', file, '--id', 'REQ-001', '--new-id', 'REQ-NEW']));
  assert.equal(ok(cli(['validate', file])).valid, true);
  assert.match(ok(cli(['render', file, '--to', 'html'])).html, /href="#REQ-NEW"/);
  const stdinFile = join(dir, 'stdin.narudoc'); await writeFile(stdinFile, source);
  ok(cli(['directive', 'insert', stdinFile, '--section', 'root', '--from', '-'], JSON.stringify(input())));
  const batchFile = join(dir, 'batch.narudoc'); await writeFile(batchFile, source);
  const plan = JSON.stringify({ schemaVersion: 1, operations: [operation(), { type: 'setDirectiveAttribute', id: 'REQ-001', key: 'status', value: 'ready' }] });
  const batchCommand = ['batch', batchFile, '--operations', '-', '--revision', revision];
  const dry = ok(cli([...batchCommand, '--dry-run'], plan)); assert.deepEqual(await readFile(batchFile), Buffer.from(source));
  const done = ok(cli(batchCommand, plan)); assert.deepEqual(done.steps, dry.steps); assert.equal(done.nextRevision, dry.nextRevision);
  assert.equal(ok(cli(['get', batchFile, '--id', 'REQ-001'])).node.attributes.find(a => a.key === 'status').value, 'ready');
});
test('final result size rejects creation in dry-run and save', async t => {
  const dir = await temporary(t), file = join(dir, 'large.narudoc'), json = join(dir, 'input.json');
  const prefix = '# Root {#root}\n\n', source = prefix + 'x'.repeat(10 * 1024 * 1024 - prefix.length);
  await writeFile(file, source); await writeFile(json, JSON.stringify(input()));
  for (const tail of [[], ['--dry-run']]) {
    fails(cli(['directive', 'insert', file, '--section', 'root', '--from', json, ...tail]), 5, 'NARU_LIMIT');
    assert.deepEqual(await readFile(file), Buffer.from(source));
  }
});
