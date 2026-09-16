import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, planOperation, planBatch } from '../../packages/core/dist/index.js';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, sep } from 'node:path';
const original = await readFile(new URL('../../examples/visual-fidelity.narudoc', import.meta.url), 'utf8');
const operation = { type: 'setInlineText', kind: 'paragraph', id: 'control', index: 0, path: '2', expected: ' is 400 V. See ', text: ' is 420 V. See ' };
for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) test(`inline source fidelity ${JSON.stringify({eol,bom})}`, () => {
  const source = bom + original.replaceAll('\n', eol), doc = parseDocument(source);
  const plan = planOperation(doc, operation);
  assert.deepEqual(Buffer.from(plan.next.source), Buffer.from(source.replace('400', '420')));
  assert.equal(plan.edits[0].expected, '0'); assert.equal(plan.edits[0].text, '2');
  assert.deepEqual(planOperation(doc, { ...operation, text: operation.expected }).edits, []);
  assert.equal(planOperation(plan.next, { ...operation, expected: operation.text, text: operation.expected }).next.source, source);
  const strong = { ...operation, path: '1.0', expected: 'reference', text: '기준😀' };
  assert.equal(planOperation(doc, strong).next.source, source.replace('**reference**', '**기준😀**'));
  const heading = { ...operation, kind: 'heading', path: '0', expected: 'Control', text: '제어😀' };
  assert.equal(planOperation(doc, heading).next.source, source.replace('Control  {#control}', '제어😀  {#control}'));
  const directive = { ...operation, kind: 'directiveParagraph', id: 'REQ-001', path: '0', expected: 'The controller shall validate its inputs.', text: '요구사항 😀' };
  assert.equal(planOperation(doc, directive).next.source, source.replace(directive.expected, directive.text));
});
test('inline protected boundaries, invalid results, stale text, delete, insert and batch parity', () => {
  const doc = parseDocument(original);
  for (const op of [{ ...operation, path: '3.0' }, { ...operation, path: '3' }, { ...operation, text: '**markup**' }, { ...operation, text: 'x\ny' }, { ...operation, text: '\ud800' }]) assert.throws(() => planOperation(doc, op));
  assert.throws(() => planOperation(doc, { ...operation, expected: 'stale' }), e => e.code === 'NARU_STALE');
  const escaped = parseDocument('# H {#h}\n\nA\\*B');
  assert.throws(() => planOperation(escaped, { ...operation, id: 'h', path: '0', expected: 'A*B', text: 'C' }), e => e.code === 'NARU_ARGUMENT');
  assert.equal(planOperation(doc, { ...operation, text: ' is V. See ' }).next.source, original.replace('400 ', ''));
  assert.equal(planOperation(doc, { ...operation, text: ' is 400😀 V. See ' }).next.source, original.replace('400', '400😀'));
  assert.equal(planBatch(doc, { schemaVersion: 1, operations: [operation] }).next.source, original.replace('400', '420'));
  assert.equal(doc.source, original);
});
test('semantic inline gaps restore a deleted run without touching marks', () => {
  const source = '# H {#h}\n\nA **bold** B';
  const remove = { ...operation, id: 'h', path: '0', expected: 'A ', text: '' };
  const deleted = planOperation(parseDocument(source), remove);
  assert.equal(deleted.next.source, '# H {#h}\n\n**bold** B');
  const restored = planOperation(deleted.next, { ...remove, expected: '', text: 'A ' });
  assert.equal(restored.next.source, source);
  assert.throws(() => planOperation(deleted.next, { ...remove, expected: '', text: '*markup*' }));
});
test('inline CLI and batch headless source matches API', async t => {
  const base = join(process.cwd(), '.narudoc-scenarios'); await mkdir(base, {recursive:true}); const dir = await mkdtemp(join(base,'inline-'));
  t.after(async()=> { assert.ok(dir.startsWith(base+sep)); await rm(dir,{recursive:true,force:true}); });
  const file = join(dir,'document.narudoc'); await writeFile(file, original);
  const result = spawnSync(process.execPath, ['apps/cli/bin/narudoc.mjs','text','set',file,'--kind','paragraph','--id','control','--index','0','--path','2','--expected',operation.expected,'--text',operation.text,'--json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.deepEqual(await readFile(file),Buffer.from(original.replace('400','420')));
});
