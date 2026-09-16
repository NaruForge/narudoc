import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load, save } from '../../apps/cli/dist/io.js';

const bin = fileURLToPath(new URL('../../apps/cli/bin/narudoc.mjs', import.meta.url));
const source = '# A {#a}\n\nThe voltage is 400 V.\n\n# B {#b}\n\nOther   text.\n';
const cli = (args, input) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input, timeout: 10000 });
async function setup(t, text = source) {
  const dir = await mkdtemp(join(tmpdir(), 'narudoc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '문서 with spaces.narudoc');
  await writeFile(file, text);
  return { dir, file };
}
function ok(result) { assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout; }

test('help and version', () => {
  assert.match(ok(cli(['--help'])), /headless/);
  assert.equal(ok(cli(['--version'])), '0.0.1\n');
  assert.equal(JSON.parse(ok(cli(['--version', '--json']))).version, '0.0.1');
});
test('inspect → dry-run → edit → validate → render', async t => {
  const { file, dir } = await setup(t);
  const inspected = JSON.parse(ok(cli(['inspect', file, '--json'])));
  assert.match(inspected.revision, /^[0-9a-f]{64}$/);
  assert.equal(inspected.offsetEncoding, 'utf-16');
  const command = ['heading', 'set-title', file, '--id', 'a', '--title', 'Changed', '--revision', inspected.revision];
  const dry = JSON.parse(ok(cli([...command, '--dry-run', '--json'])));
  assert.equal(dry.changed, true); assert.equal(dry.edits.length, 1);
  assert.equal(await readFile(file, 'utf8'), source);
  assert.match(ok(cli([...command, '--dry-run'])), /UTF-16/);
  const applied = JSON.parse(ok(cli([...command, '--json'])));
  assert.equal(applied.nextRevision, dry.nextRevision);
  assert.equal(await readFile(file, 'utf8'), source.replace('# A', '# Changed'));
  const valid = JSON.parse(ok(cli(['validate', file, '--json']))); assert.equal(valid.valid, true);
  const out = join(dir, 'out.html'); ok(cli(['render', file, '--to', 'html', '--output', out]));
  assert.match(await readFile(out, 'utf8'), /<h1 id="a">Changed<\/h1>/);
  assert.match(ok(cli(['render', file, '--to', 'html'])), /^<!doctype html>/);
  assert.ok(JSON.parse(ok(cli(['render', file, '--to', 'html', '--json']))).html);
});
test('all semantic authoring commands execute through the CLI', async t => {
  const { file } = await setup(t);
  ok(cli(['section', 'insert', file, '--after', 'a', '--id', 'c', '--title', 'C']));
  assert.deepEqual(JSON.parse(ok(cli(['outline', file, '--json']))).sections.map(s => s.id), ['a', 'c', 'b']);
  ok(cli(['section', 'move', file, '--id', 'c', '--after', 'b']));
  ok(cli(['section', 'remove', file, '--id', 'c']));
  assert.equal(await readFile(file, 'utf8'), source);
  ok(cli(['paragraph', 'replace', file, '--id', 'a', '--index', '0', '--text', 'The voltage is 420 V.']));
  assert.equal(await readFile(file, 'utf8'), source.replace('400', '420'));
  await writeFile(file, ':::requirement\nid: REQ-1\nstatus: draft\n:::\n');
  ok(cli(['directive', 'set', file, '--id', 'REQ-1', '--key', 'status', '--value', 'approved']));
  assert.match(await readFile(file, 'utf8'), /status: approved/);
  assert.equal(JSON.parse(ok(cli(['get', file, '--id', 'REQ-1', '--json']))).node.type, 'directive');
});
test('get section returns exact original text', async t => {
  const { file } = await setup(t);
  assert.equal(ok(cli(['get', file, '--id', 'a'])), source.slice(0, source.indexOf('# B')));
});
test('new creates a valid source and never clobbers', async t => {
  const { dir } = await setup(t), file = join(dir, 'new.narudoc');
  ok(cli(['new', file, '--title', 'New', '--id', 'new']));
  assert.equal(await readFile(file, 'utf8'), '# New {#new}\n');
  assert.equal(cli(['new', file]).status, 5);
  assert.equal(await readFile(file, 'utf8'), '# New {#new}\n');
  assert.ok((await readdir(dir)).every(f => !f.includes('narudoc-tmp')));
});
test('stdin is non-interactive and query-only', () => {
  const result = JSON.parse(ok(cli(['inspect', '--stdin', '--json'], source)));
  assert.equal(result.sourceLength, source.length);
  assert.match(ok(cli(['render', '-', '--to', 'html'], source)), /^<!doctype html>/);
  assert.equal(cli(['heading', 'set-title', '-', '--id', 'a', '--title', 'B'], source).status, 2);
});
test('no-op preserves bytes and mtime without leftover lock/temp', async t => {
  const { file, dir } = await setup(t, '\ufeff' + source.replaceAll('\n', '\r\n'));
  const before = await readFile(file), modified = (await stat(file)).mtimeMs;
  const result = JSON.parse(ok(cli(['heading', 'set-title', file, '--id', 'a', '--title', 'A', '--json'])));
  assert.equal(result.changed, false);
  assert.deepEqual(await readFile(file), before); assert.equal((await stat(file)).mtimeMs, modified);
  assert.equal((await readdir(dir)).length, 1);
});
test('CRLF and BOM survive real file writes', async t => {
  const original = '\ufeff' + source.replaceAll('\n', '\r\n');
  const { file } = await setup(t, original);
  ok(cli(['paragraph', 'replace', file, '--id', 'a', '--index', '0', '--text', 'The voltage is 420 V.']));
  assert.deepEqual(await readFile(file), Buffer.from(original.replace('400', '420')));
});
test('stale revision fails on stderr JSON and leaves file unchanged', async t => {
  const { file } = await setup(t);
  const result = cli(['heading', 'set-title', file, '--id', 'a', '--title', 'B', '--revision', 'stale', '--json']);
  assert.equal(result.status, 4); assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'NARU_STALE');
  assert.equal(await readFile(file, 'utf8'), source);
});
test('invalid semantic writes and rendering never alter input', async t => {
  const invalid = '# A {#a}\n\n[B](#missing)\n';
  const { file, dir } = await setup(t, invalid);
  assert.equal(cli(['heading', 'set-title', file, '--id', 'a', '--title', 'Changed']).status, 3);
  assert.equal(cli(['render', file, '--to', 'html', '--output', join(dir, 'bad.html')]).status, 3);
  const validated = cli(['validate', file, '--json']);
  assert.equal(validated.status, 3); assert.equal(JSON.parse(validated.stdout).valid, false);
  assert.equal(await readFile(file, 'utf8'), invalid);
});
test('malformed UTF-8 is rejected rather than replaced silently', async t => {
  const bytes = Buffer.from([0x23, 0x20, 0xff]); const { file } = await setup(t, bytes);
  const result = cli(['inspect', file, '--json']);
  assert.equal(result.status, 3); assert.equal(JSON.parse(result.stderr).error.code, 'NARU_ENCODING');
  assert.deepEqual(await readFile(file), bytes);
});
test('output cannot overwrite input or an existing output file', async t => {
  const { file } = await setup(t);
  assert.equal(cli(['render', file, '--to', 'html', '--output', file]).status, 5);
  assert.equal(await readFile(file, 'utf8'), source);
});
test('existing writer lock is preserved', async t => {
  const { file } = await setup(t); await writeFile(file + '.lock', 'other writer');
  const result = cli(['heading', 'set-title', file, '--id', 'a', '--title', 'Changed', '--json']);
  assert.equal(result.status, 4); assert.equal(JSON.parse(result.stderr).error.code, 'NARU_LOCKED');
  assert.equal(await readFile(file + '.lock', 'utf8'), 'other writer');
  assert.equal(await readFile(file, 'utf8'), source);
});
test('file adapter rechecks the source before committing, including no-op', async t => {
  const { file, dir } = await setup(t), snapshot = await load(file);
  await writeFile(file, source + 'External change.');
  await assert.rejects(save(snapshot, source.replace('400', '420')), { code: 'NARU_STALE' });
  await assert.rejects(save(snapshot, source), { code: 'NARU_STALE' });
  assert.equal(await readFile(file, 'utf8'), source + 'External change.');
  assert.equal((await readdir(dir)).length, 1);
});
test('two cooperative writers never silently overwrite each other', async t => {
  const { file, dir } = await setup(t), snapshot = await load(file);
  const results = await Promise.allSettled([save(snapshot, source.replace('400', '410')), save(snapshot, source.replace('400', '420'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.ok([source.replace('400', '410'), source.replace('400', '420')].includes(await readFile(file, 'utf8')));
  assert.equal((await readdir(dir)).length, 1);
});
test('symlink inputs and ancestor directories rejected', async t => {
  const { file, dir } = await setup(t), linked = join(dir, 'linked.narudoc');
  try { await symlink(file, linked); } catch (e) { if (e.code === 'EPERM') { t.skip('Host does not permit creating symlink fixture'); return; } throw e; }
  assert.equal(cli(['heading', 'set-title', linked, '--id', 'a', '--title', 'B']).status, 5);
  const alias = join(dir, 'alias'); await symlink(dir, alias, 'junction');
  assert.equal(cli(['new', join(alias, 'outside.narudoc')]).status, 5);
  assert.equal(await readFile(file, 'utf8'), source);
});
test('hardlinked input is rejected', async t => {
  const { file, dir } = await setup(t); await link(file, join(dir, 'other.narudoc'));
  assert.equal(cli(['heading', 'set-title', file, '--id', 'a', '--title', 'B']).status, 5);
  assert.equal(await readFile(file, 'utf8'), source);
});
test('unknown commands, options and duplicates are usage errors', async t => {
  const { file } = await setup(t);
  for (const args of [[], ['--typo'], ['unknown', file], ['outline', file, '--dry-run'], ['get', file], ['inspect', file, '--json', '--json'], ['heading', 'set-title', file, '--id', 'a'], ['inspect', file, '--stdin'], ['inspect', file, 'extra'], ['render', file, '--to', 'pdf']]) {
    if (!args.length) continue;
    assert.equal(cli(args).status, 2, JSON.stringify(args));
  }
});
test('git diff contains only the intended content change', async t => {
  const { dir, file } = await setup(t);
  const git = args => spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(git(['init', '-q']).status, 0);
  assert.equal(git(['add', '.']).status, 0);
  assert.equal(git(['-c', 'user.name=NaruDoc Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']).status, 0);
  ok(cli(['paragraph', 'replace', file, '--id', 'a', '--index', '0', '--text', 'The voltage is 420 V.']));
  const diff = git(['diff', '--no-ext-diff', '--unified=0']).stdout;
  assert.match(diff, /-The voltage is 400 V\./); assert.match(diff, /\+The voltage is 420 V\./);
  const changed = diff.split('\n').filter(line => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line));
  assert.equal(changed.length, 2); assert.equal(git(['diff', '--check']).status, 0);
});
