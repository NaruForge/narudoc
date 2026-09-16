import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTextEdits, parseDocument, planBatch } from '../../packages/core/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = join(root, '.narudoc-scenarios');
const bin = join(root, 'apps/cli/bin/narudoc.mjs');
const cli = (args, input) => spawnSync(process.execPath, [bin, ...args, '--json'], { encoding: 'utf8', input, timeout: 15000 });
const success = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); };
const failure = (result, status, code, index) => {
  assert.equal(result.status, status, result.stderr || result.error?.message);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, code);
  assert.equal(error.operationIndex, index);
};
const request = operations => ({ schemaVersion: 1, operations });
const title = name => ({ type: 'setHeadingTitle', id: 'a', title: name });
async function setup(t, source = '# A {#a}\n\nOld text.\n') {
  await mkdir(outputRoot, { recursive: true });
  const dir = await mkdtemp(join(outputRoot, 'batch-test-'));
  t.after(async () => {
    assert.ok(dir.startsWith(outputRoot + sep));
    await rm(dir, { recursive: true, force: true });
  });
  const file = join(dir, '문서 with spaces.narudoc');
  await writeFile(file, source);
  const revision = success(cli(['validate', file])).revision;
  const run = (operations, extra = [], rev = revision) => cli(['batch', file, '--operations', '-', '--revision', rev, ...extra], JSON.stringify(request(operations)));
  return { dir, file, revision, run };
}

test('core batch uses evolving snapshots and supports all six operations without mutating input', () => {
  const source = '# A {#a}\n\nOld text.\n\n:::requirement\nid: REQ-1\nstatus: draft\n:::\n\n# B {#b}\n';
  const doc = parseDocument(source);
  const before = JSON.stringify(doc);
  const operations = [
    { type: 'insertSection', after: 'a', id: 'c', title: 'C' },
    { type: 'setHeadingTitle', id: 'c', title: '새 절 😀' },
    { type: 'moveSection', id: 'c', after: 'b' },
    { type: 'removeSection', id: 'c' },
    { type: 'replaceParagraph', id: 'a', index: 0, text: 'Longer text 😀.' },
    { type: 'setDirectiveAttribute', id: 'REQ-1', key: 'status', value: 'reviewed' },
  ];
  const plan = planBatch(doc, request(operations));
  assert.equal(JSON.stringify(doc), before);
  assert.equal(plan.baseSource, source);
  assert.equal(plan.next.source, source.replace('Old text.', 'Longer text 😀.').replace('status: draft', 'status: reviewed'));
  let replay = source;
  for (const [index, step] of plan.steps.entries()) {
    assert.equal(step.operationIndex, index);
    replay = applyTextEdits(replay, step.edits);
  }
  assert.equal(replay, plan.next.source);
  assert.throws(() => planBatch(doc, request([...operations, { type: 'removeSection', id: 'missing' }])),
    error => error.code === 'NARU_TARGET' && error.operationIndex === 6);
  assert.equal(JSON.stringify(doc), before);
});

for (const bomCrlf of [false, true]) test(`engineering batch: dry-run, single save, preservation and HTML (${bomCrlf ? 'BOM CRLF' : 'LF'})`, async t => {
  let source = (await readFile(join(root, 'examples/engineering.narudoc'), 'utf8')).replaceAll('\r\n', '\n');
  if (bomCrlf) source = '\uFEFF' + source.replaceAll('\n', '\r\n');
  const { dir, file, revision } = await setup(t, source);
  const operations = JSON.parse(await readFile(join(root, 'examples/engineering-edit.json'), 'utf8'));
  const planFile = join(dir, 'plan.json');
  await writeFile(planFile, '\uFEFF' + JSON.stringify(operations));
  const args = ['batch', file, '--operations', planFile, '--revision', revision];
  const before = await readFile(file);
  const dry = success(cli([...args, '--dry-run']));
  assert.equal(dry.dryRun, true);
  assert.deepEqual(await readFile(file), before);
  const saved = success(cli(args));
  assert.equal(saved.dryRun, false);
  assert.equal(saved.changed, true);
  assert.equal(saved.revision, revision);
  assert.equal(saved.nextRevision, dry.nextRevision);
  assert.deepEqual(saved.steps, dry.steps);
  assert.equal(Object.hasOwn(saved, 'edits'), false);
  let expected = source.replace('400 V.', '420 V.').replace('status: draft', 'status: reviewed');
  const start = expected.indexOf('## DC-Link Control'), end = expected.indexOf('## Validation');
  expected = expected.slice(0, start) + expected.slice(end) + expected.slice(start, end);
  assert.deepEqual(await readFile(file), Buffer.from(expected));
  let replay = source;
  for (const step of saved.steps) replay = applyTextEdits(replay, step.edits);
  assert.equal(replay, expected);
  assert.equal(success(cli(['validate', file])).valid, true);
  const html = success(cli(['render', file, '--to', 'html'])).html;
  assert.match(html, /420 V/);
  assert.match(html, /<dt>status<\/dt><dd>reviewed<\/dd>/);
  assert.match(html, /href="#REQ-001"/);
  assert.deepEqual((await readdir(dir)).sort(), ['plan.json', '문서 with spaces.narudoc']);
});

test('last operation failure and invalid intermediate references leave original bytes and mtime', async t => {
  const source = '# A {#a}\n\nSee [B](#b).\n\n# B {#b}\n';
  const { dir, file, run } = await setup(t, source);
  const before = await readFile(file), mtime = (await stat(file)).mtimeMs;
  for (const extra of [[], ['--dry-run']]) {
    failure(run([title('Changed'), { type: 'removeSection', id: 'missing' }], extra), 2, 'NARU_TARGET', 1);
    failure(run([{ type: 'removeSection', id: 'b' }, { type: 'replaceParagraph', id: 'a', index: 0, text: 'No reference.' }], extra), 3, 'NARU_INVALID_DOCUMENT', 0);
    assert.deepEqual(await readFile(file), before);
    assert.equal((await stat(file)).mtimeMs, mtime);
  }
  assert.deepEqual(await readdir(dir), ['문서 with spaces.narudoc']);
});

test('batch revision and cooperative lock failures never save partial edits', async t => {
  const { file, revision, run } = await setup(t);
  const original = await readFile(file);
  await writeFile(file, original.toString().replace('Old text.', 'External change.'));
  const current = await readFile(file);
  failure(run([title('Changed')]), 4, 'NARU_STALE');
  assert.deepEqual(await readFile(file), current);
  await writeFile(file, original);
  await writeFile(file + '.lock', 'existing lock');
  assert.equal(success(run([title('Changed')], ['--dry-run'])).changed, true);
  failure(run([title('Changed')]), 4, 'NARU_LOCKED');
  assert.equal(await readFile(file + '.lock', 'utf8'), 'existing lock');
  assert.deepEqual(await readFile(file), original);
  failure(cli(['batch', file, '--operations', '-'], '{}'), 2, 'NARU_ARGUMENT');
  failure(run([title('Changed')], [], 'invalid'), 2, 'NARU_ARGUMENT');
  failure(cli(['batch', '-', '--operations', '-', '--revision', revision], '{}'), 2, 'NARU_ARGUMENT');
});

test('net no-op preserves bytes and mtime while reporting sequential edits', async t => {
  const { dir, file, run } = await setup(t, '\uFEFF# A {#a}\r\n\r\n한글 😀.\r\n');
  const before = await readFile(file), mtime = (await stat(file)).mtimeMs;
  const result = success(run([title('Temporary 😀'), title('A')]));
  assert.equal(result.changed, false);
  assert.equal(result.revision, result.nextRevision);
  assert.ok(result.steps.every(step => step.edits.length > 0));
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file)).mtimeMs, mtime);
  assert.deepEqual(await readdir(dir), ['문서 with spaces.narudoc']);
});

test('text batch preview labels snapshot boundaries and failures identify the operation', async t => {
  const { file, revision } = await setup(t);
  const args = [bin, 'batch', file, '--operations', '-', '--revision', revision];
  const before = await readFile(file);
  const preview = spawnSync(process.execPath, [...args, '--dry-run'], {
    encoding: 'utf8', timeout: 15000, input: JSON.stringify(request([title('Longer title'), title('A')])),
  });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Operation 0 \(offsets in this step's input\)/);
  assert.match(preview.stdout, /Operation 1 \(offsets in this step's input\)/);
  assert.deepEqual(await readFile(file), before);
  const failed = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 15000, input: JSON.stringify(request([title('B'), { type: 'removeSection', id: 'missing' }])),
  });
  assert.equal(failed.status, 2);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /NARU_TARGET: Operation 1:/);
  assert.deepEqual(await readFile(file), before);
});

test('strict batch input rejects malformed JSON, types, fields, limits and Unicode without writes', async t => {
  const { file, revision } = await setup(t);
  const before = await readFile(file);
  const invalid = ['{', 'null', '[]', JSON.stringify({ schemaVersion: 2, operations: [title('B')] }),
    JSON.stringify({ ...request([title('B')]), extra: true }), JSON.stringify(request([])),
    JSON.stringify(request(Array.from({ length: 101 }, () => title('B'))))];
  for (const value of [null, [], { type: 'constructor' }, { ...title('B'), extra: true },
    { type: 'setHeadingTitle', id: 'a' }, title(1), title('\ud800'),
    { type: 'replaceParagraph', id: 'a', index: '0', text: 'Text.' },
    { type: 'replaceParagraph', id: 'a', index: 0.5, text: 'Text.' },
    { type: 'replaceParagraph', id: 'a', index: Number.MAX_SAFE_INTEGER + 1, text: 'Text.' }]) {
    const result = cli(['batch', file, '--operations', '-', '--revision', revision], JSON.stringify(request([title('B'), value])));
    failure(result, 2, 'NARU_ARGUMENT', 1);
  }
  for (const input of invalid) failure(cli(['batch', file, '--operations', '-', '--revision', revision], input), 2, 'NARU_ARGUMENT');
  failure(cli(['batch', file, '--operations', '-', '--revision', revision], Buffer.from([0xc3, 0x28])), 3, 'NARU_ENCODING');
  failure(cli(['batch', file, '--operations', '-', '--revision', revision], ' '.repeat(10 * 1024 * 1024 + 1)), 5, 'NARU_LIMIT');
  assert.deepEqual(await readFile(file), before);
  const doc = parseDocument('# A {#a}\n');
  assert.equal(planBatch(doc, request(Array.from({ length: 100 }, () => title('A')))).next.source, doc.source);
});

test('oversized final batch result fails before save in preview and real modes', async t => {
  const source = '# A {#a}\n\nOld text.\n\n```text\n' + 'x'.repeat(6 * 1024 * 1024) + '\n```\n';
  const { file, run } = await setup(t, source);
  const operations = [title('Changed'), { type: 'replaceParagraph', id: 'a', index: 0, text: 'y'.repeat(5 * 1024 * 1024) }];
  for (const extra of [[], ['--dry-run']]) {
    failure(run(operations, extra), 5, 'NARU_LIMIT');
    assert.deepEqual(await readFile(file), Buffer.from(source));
  }
});
