import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat, link } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startEditor } from '../../apps/web/dist/index.js';
import { load, save } from '../../packages/file-store/dist/index.js';
import { parseDocument, planOperation } from '../../packages/core/dist/index.js';
const source = '\uFEFF# Control  {#control}\r\n\r\nThe **reference** is 400 V.\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |';
const op = { type: 'setInlineText', kind: 'paragraph', id: 'control', index: 0, path: '2', expected: ' is 400 V.', text: ' is 420 V.' };
async function setup(t, text = source) {
  await mkdir('.narudoc-scenarios', { recursive: true });
  const dir = await mkdtemp(resolve('.narudoc-scenarios/web-'));
  const file = join(dir, 'document.narudoc'); await writeFile(file, text);
  const editor = await startEditor(file);
  t.after(async () => { await editor.close(); await rm(dir, { recursive: true, force: true }); });
  const call = async (route, input, headers = {}) => {
    const response = await fetch(editor.origin + route, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + editor.token, Origin: editor.origin, ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { file, editor, call };
}
test('web semantic save/no-op uses shared store, exact bytes and export no-clobber', async t => {
  const { file, call } = await setup(t);
  const doc = (await call('/api/document')).body; const before = await stat(file);
  assert.equal((await call('/api/save', { revision: doc.revision, operations: [] })).status, 200);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  const expected = source.replace('400', '420');
  const result = await call('/api/save', { revision: doc.revision, operations: [op] });
  assert.equal(result.status, 200); assert.equal(result.body.source, expected);
  assert.deepEqual(await readFile(file), Buffer.from(expected));
  assert.equal(expected, planOperation(parseDocument(source), op).next.source);
  const exported = await call('/api/export', { revision: result.body.revision, operations: [] });
  assert.equal(exported.status, 200); assert.match(await readFile(file + '.html', 'utf8'), /<table>/);
  assert.equal((await call('/api/export', { revision: result.body.revision, operations: [] })).body.code, 'EEXIST');
});
test('stale tab/CLI, locks and late batch failures never overwrite disk', async t => {
  const { file, call } = await setup(t); const doc = (await call('/api/document')).body;
  await writeFile(file + '.lock', 'writer');
  assert.equal((await call('/api/save', { revision: doc.revision, operations: [op] })).body.code, 'NARU_LOCKED');
  await rm(file + '.lock');
  const failed = await call('/api/save', { revision: doc.revision, operations: [op, { type: 'removeSection', id: 'missing' }] });
  assert.equal(failed.status, 400); assert.equal(await readFile(file, 'utf8'), source);
  await save(await load(file), source.replace('400', '410'));
  const stale = await call('/api/save', { revision: doc.revision, operations: [op] });
  assert.equal(stale.status, 409); assert.equal(stale.body.latestRevision, (await load(file)).revision);
  assert.equal(await readFile(file, 'utf8'), source.replace('400', '410'));
});
test('local security rejects origin/session/path/raw source and unexpected fields', async t => {
  const { call, editor, file } = await setup(t); const doc = (await call('/api/document')).body;
  assert.equal((await call('/api/document', undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/document', undefined, { Authorization: 'Bearer wrong' })).status, 403);
  assert.equal((await call('/api/document?path=../secret')).status, 404);
  assert.equal((await call('/api/save', { revision: doc.revision, source })).status, 400);
  assert.equal((await call('/api/save', { revision: doc.revision, operations: [], path: file })).status, 400);
  assert.equal((await call('/api/save', { revision: doc.revision, operations: [{ ...op, raw: true }] })).status, 400);
  const noOrigin = await fetch(editor.origin + '/api/save', { method: 'POST', headers: { Authorization: 'Bearer ' + editor.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: doc.revision, operations: [] }) });
  assert.equal(noOrigin.status, 403); assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);
  const wrongHost = await new Promise((ok, fail) => { const req = httpRequest(editor.origin + '/api/document', { headers: { Host: 'evil.example', Authorization: 'Bearer ' + editor.token } }, res => { res.resume(); ok(res.statusCode); }); req.on('error', fail); req.end(); });
  assert.equal(wrongHost, 403);
  const options = await fetch(editor.origin + '/api/save', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }); assert.equal(options.status, 403);
  assert.equal(await readFile(file, 'utf8'), source);
});
test('invalid documents remain readable, file size/encoding/hardlinks are enforced', async t => {
  const { file, call } = await setup(t, '# Missing ID\n\n# A {#a}\n\n# Duplicate {#a}');
  const doc = (await call('/api/document')).body; assert.ok(doc.diagnostics.length);
  assert.equal((await call('/api/save', { revision: doc.revision, operations: [] })).status, 400);
  await writeFile(file, Buffer.from([0xff])); assert.equal((await call('/api/document')).body.code, 'NARU_ENCODING');
  await writeFile(file, 'x'.repeat(10 * 1024 * 1024 + 1)); assert.equal((await call('/api/document')).body.code, 'NARU_LIMIT');
  await writeFile(file, source); const other = file + '.linked'; await link(file, other);
  assert.equal((await call('/api/document')).body.code, 'NARU_IO');
});
test('more than 100 keystrokes are sequential Core batches with one atomic save', async t => {
  const { call, file } = await setup(t, '# A {#a}\n\n0'); const doc = (await call('/api/document')).body;
  const operations = Array.from({ length: 105 }, (_, i) => ({ type: 'setInlineText', kind: 'paragraph', id: 'a', index: 0, path: '0', expected: String(i), text: String(i + 1) }));
  assert.equal((await call('/api/save', { revision: doc.revision, operations: [...operations, { type: 'removeSection', id: 'bad' }] })).status, 400);
  assert.equal(await readFile(file, 'utf8'), '# A {#a}\n\n0');
  assert.equal((await call('/api/save', { revision: doc.revision, operations })).status, 200);
  assert.equal(await readFile(file, 'utf8'), '# A {#a}\n\n105');
});
