import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { operationDefinitions, readOperation } from '../../packages/model/dist/index.js';
import { parseDocument, planOperation, planSequence, planBatch } from '../../packages/core/dist/index.js';
import { revision, parseJsonInput } from '../../packages/file-store/dist/index.js';
import { startEditor } from '../../apps/web/dist/index.js';
import { operationBindings, operationExample, commandHelp, capabilities, checkBindings, createCommands, commandReference } from '../../apps/cli/dist/commands.js';
import { checkGenerated, verifyContracts } from '../../scripts/verify-contracts.mjs';

const cliPath = fileURLToPath(new URL('../../apps/cli/bin/narudoc.mjs', import.meta.url));
const cli = (args, input) => spawnSync(process.execPath, [cliPath, ...args], { input, encoding: 'utf8' });
const source = '\uFEFF# Control  {#control}\r\n\r\nA.\r\n\r\n| Parameter | Value |\r\n| --- | --- |\r\n| Voltage | 400 |\r\n\r\n:::requirement\r\nid: REQ-1\r\nstatus: draft\r\n\r\nCheck voltage.\r\n:::\r\n\r\n## Details {#details}\r\n\r\nKeep 한글 😀.\r\n\r\n# Second {#second}\r\n\r\nSecond.\r\n\r\n# Third {#third}\r\n\r\nThird.\r\n';
test('prototype names are unknown commands, not internal exceptions', () => {
  for (const command of ['constructor', 'toString', '__proto__']) {
    const result = cli([command, '--json']);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).error.code, 'NARU_ARGUMENT');
  }
});
test('public TypeScript inputs infer required/optional fields and enums from definitions', () => {
  const program = ts.createProgram([fileURLToPath(new URL('../contracts/input-types.ts', import.meta.url))], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
// Authored expectations: none are produced by a serializer/planner under test.
const expected = {
  setInlineText: source.replace('A.', 'A revised.'),
  insertTable: source.replace(':::\r\n\r\n## Details', ':::\r\n\r\n| Parameter | Value |\r\n| --- | --- |\r\n| Voltage | 400 |\r\n\r\n## Details'),
  setTableCell: source.replace('400', '420'),
  insertDirective: source.replace(':::\r\n\r\n## Details', ':::\r\n\r\n:::requirement\r\nid: REQ-NEW\r\nstatus: draft\r\n\r\nCheck the voltage.\r\n:::\r\n\r\n## Details'),
  renameId: source.replace('{#control}', '{#control-v2}'),
  setHeadingTitle: source.replace('Control  {#control}', 'Control design  {#control}'),
  insertSection: source.replace('# Second', '# Design {#design}\r\n\r\n# Second'),
  insertChildSection: source.replace('Keep 한글 😀.', 'Keep 한글 😀.\r\n\r\n## Design {#design}'),
  removeSection: source.replace('## Details {#details}\r\n\r\nKeep 한글 😀.\r\n\r\n', ''),
  moveSection: source.replace('# Second {#second}\r\n\r\nSecond.\r\n\r\n# Third {#third}\r\n\r\nThird.\r\n', '# Third {#third}\r\n\r\nThird.\r\n# Second {#second}\r\n\r\nSecond.\r\n\r\n'),
  replaceParagraph: source.replace('A.', 'A revised.'),
  insertParagraph: source.replace('A.', 'New paragraph.\r\n\r\nA.'),
  replaceDirectiveParagraph: source.replace('Check voltage.', 'Check revised voltage.'),
  setDirectiveAttribute: source.replace('status: draft', 'status: verified'),
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'naru-contract-')), file = join(dir, 'practice.narudoc');
  await writeFile(file, source); t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await startEditor(file); t.after(() => server.close());
  const post = async (operations, raw) => {
    const response = await fetch(server.origin + '/api/save', { method: 'POST', headers: { Origin: server.origin, Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify({ revision: revision(source), operations }) });
    return { status: response.status, body: await response.json() };
  };
  return { dir, file, post };
}
for (const [type, definition] of Object.entries(operationDefinitions)) test(`contract example ${type}: Core / CLI route / batch / HTTP exact bytes`, async t => {
  const { dir, file, post } = await fixture(t), operation = { type, ...definition.example };
  assert.equal(planOperation(parseDocument(source), operation).next.source, expected[type]);
  assert.equal(planBatch(parseDocument(source), { schemaVersion: 1, operations: [operation] }).next.source, expected[type]);
  const example = operationExample(type), args = [...example.args]; args[args.indexOf('practice.narudoc')] = file;
  if (args.includes('SHA256')) args[args.indexOf('SHA256')] = revision(source);
  if (Object.keys(example.json).length) { const input = join(dir, 'input.json'); await writeFile(input, JSON.stringify(example.json)); args[args.indexOf('input.json')] = input; }
  const result = cli([...args, '--json']); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(file), Buffer.from(expected[type]));
  await writeFile(file, source);
  const result2 = cli(['batch', file, '--operations', '-', '--revision', revision(source), '--json'], JSON.stringify({ schemaVersion: 1, operations: [operation] }));
  assert.equal(result2.status, 0, result2.stderr); assert.deepEqual(await readFile(file), Buffer.from(expected[type]));
  await writeFile(file, source);
  const response = await post([operation]); assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(await readFile(file), Buffer.from(expected[type]));
});
test('common invalid corpus keeps failure codes/index and original bytes/mtime across API, batch, HTTP', async t => {
  const { file, post } = await fixture(t), before = await stat(file);
  const valid = { type: 'setHeadingTitle', id: 'control', title: 'Changed' };
  const corpus = [
    { ...operationDefinitions.setTableCell.example, type: 'setTableCell', part: 'footer' },
    { ...valid, title: 2 }, { ...valid, unexpected: true }, { ...valid, id: 'missing' },
    { ...valid, title: '[broken](#missing)' },
    { type: 'insertDirective', ...operationDefinitions.insertDirective.example, children: [{ type: 'code', value: 'x', extra: true }] },
    { ...valid, title: '\ud800' },
  ];
  for (const bad of corpus) {
    let error; try { planOperation(parseDocument(source), bad); assert.fail('expected failure'); } catch (e) { error = e; }
    assert.match(error.code, /^NARU_/);
    const operations = [valid, bad], result = cli(['batch', file, '--operations', '-', '--revision', revision(source), '--json'], JSON.stringify({ schemaVersion: 1, operations }));
    const batchError = JSON.parse(result.stderr).error;
    assert.equal(batchError.code, error.code); assert.equal(batchError.operationIndex, 1);
    const response = await post(operations); assert.equal(response.status, 400);
    assert.equal(response.body.code, error.code); assert.equal(response.body.operationIndex, 1);
    assert.deepEqual(response.body.diagnostics, batchError.diagnostics);
    assert.deepEqual(await readFile(file), Buffer.from(source)); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  }
  const standalone = cli(['table', 'set-cell', file, '--section', 'control', '--index', '0', '--part', 'footer', '--row', '0', '--column', '0', '--text', 'x', '--json']);
  assert.equal(JSON.parse(standalone.stderr).error.code, 'NARU_ARGUMENT');
  const invalidDto = cli(['directive', 'insert', file, '--section', 'control', '--from', '-', '--json'], JSON.stringify({ ...operationDefinitions.insertDirective.example, sectionId: undefined, extra: true }));
  assert.equal(JSON.parse(invalidDto.stderr).error.code, 'NARU_ARGUMENT');
});
test('JSON text boundary shares duplicate-key, BOM and encoding policy', async t => {
  const { file, post } = await fixture(t);
  for (const duplicate of ['"title":"One","title":"Two"', '"title":"One","ti\\u0074le":"Two"']) {
    const op = '{"type":"setHeadingTitle","id":"control",' + duplicate + '}';
    assert.throws(() => parseJsonInput(op), { code: 'NARU_ARGUMENT' });
    const response = await post([], '{"revision":"' + revision(source) + '","operations":[' + op + ']}');
    assert.equal(response.body.code, 'NARU_ARGUMENT');
    const result = cli(['batch', file, '--operations', '-', '--revision', revision(source), '--json'], '{"schemaVersion":1,"operations":[' + op + ']}');
    assert.equal(JSON.parse(result.stderr).error.code, 'NARU_ARGUMENT');
    assert.deepEqual(await readFile(file), Buffer.from(source));
  }
  assert.equal((await post([], '\uFEFF' + JSON.stringify({ revision: revision(source), operations: [] }))).status, 200);
  assert.equal((await post([], Buffer.from([0xff]))).body.code, 'NARU_ENCODING');
});
test('sequence preserves lazy first failure, global index after 100, diagnostics and empty web no-op', async t => {
  const { file, post } = await fixture(t);
  assert.throws(() => planSequence(parseDocument(source), [{ type: 'removeSection', id: 'missing' }, { type: 'invalid' }]), e => e.code === 'NARU_TARGET' && e.operationIndex === 0);
  const operations = Array.from({ length: 101 }, () => ({ type: 'setHeadingTitle', id: 'control', title: 'Control' }));
  operations.push({ type: 'setHeadingTitle', id: 'control', title: '[broken](#missing)' });
  const response = await post(operations); assert.equal(response.body.operationIndex, 101);
  assert.equal(response.body.code, 'NARU_INVALID_DOCUMENT'); assert.ok(response.body.diagnostics.length);
  assert.deepEqual(await readFile(file), Buffer.from(source));
  assert.equal((await post([])).status, 200);
  assert.throws(() => planBatch(parseDocument(source), { schemaVersion: 1, operations: [] }), { code: 'NARU_ARGUMENT' });
});
test('all help levels are file-free and capability is bounded; intentional contract drift fails', async () => {
  for (const args of [[], ['table'], ['table', 'set-cell', 'does-not-exist.narudoc']]) {
    const result = cli([...args, '--help']); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /narudoc/);
  }
  const list = capabilities(); assert.equal(list.operations.length, 14); assert.ok(!JSON.stringify(list).includes('properties'));
  for (const type of Object.keys(operationDefinitions)) { readOperation(capabilities(type).example); assert.match(commandHelp((operationBindings[type]?.command ?? 'batch').split(' ')), /Example:/); }
  assert.throws(() => checkBindings(operationDefinitions, { ...operationBindings, fake: { command: 'fake', fields: {} } }), /coverage drift/);
  const wrong = structuredClone(operationBindings); delete wrong.setTableCell.fields.part;
  assert.throws(() => checkBindings(operationDefinitions, wrong), /field\/binding drift/);
  const schema = structuredClone(operationDefinitions); schema.setTableCell.input.properties.newField = { type: 'string' };
  assert.throws(() => checkBindings(schema, operationBindings), /field\/binding drift/);
  const changedEnum = structuredClone(operationDefinitions); changedEnum.setTableCell.input.properties.part.enum = ['header'];
  // The example is checked against the changed definition, not against itself.
  const { validateInput } = await import('../../packages/model/dist/index.js');
  assert.throws(() => validateInput(changedEnum.setTableCell.input, changedEnum.setTableCell.example), { code: 'NARU_ARGUMENT' });
  assert.throws(() => checkGenerated('stale enum/options reference', 'current reference'), /reference drift/);
  await verifyContracts();
});
test('explicit API/batch-only client choice stays discoverable without requiring a standalone command', async t => {
  const choices = { ...operationBindings, setHeadingTitle: null };
  checkBindings(operationDefinitions, choices);
  assert.equal(Object.hasOwn(createCommands(choices), 'heading set-title'), false);
  assert.equal(Object.hasOwn(createCommands(choices), 'batch'), true);
  assert.doesNotMatch(commandHelp([], createCommands(choices)), /heading set-title/);
  assert.doesNotMatch(commandReference(createCommands(choices)), /heading set-title/);
  assert.equal(capabilities(undefined, choices).operations.find(op => op.type === 'setHeadingTitle').command, 'batch');
  const example = capabilities('setHeadingTitle', choices).cli;
  assert.deepEqual(example.json, { schemaVersion: 1, operations: [{ type: 'setHeadingTitle', id: 'control', title: 'Control design' }] });
  const { dir, file } = await fixture(t), input = join(dir, 'input.json');
  await writeFile(input, JSON.stringify(example.json));
  const queried = cli(['inspect', file, '--json']); assert.equal(queried.status, 0, queried.stderr);
  const currentRevision = JSON.parse(queried.stdout).revision;
  const args = example.args.map(value => value === 'practice.narudoc' ? file : value === 'input.json' ? input : value === 'SHA256' ? currentRevision : value);
  const result = cli([...args, '--json']); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(file), Buffer.from(expected.setHeadingTitle));
  const missing = { ...choices }; delete missing.setHeadingTitle;
  assert.throws(() => checkBindings(operationDefinitions, missing), /coverage drift/);
});
test('exact section and directive paragraph no-op preserve mixed EOL independently', () => {
  const input = '\uFEFF# Control {#control}\r\n\r\nA\nB\rC\r\n\r\n:::note\r\nid: N\r\n\r\nD\nE\rF\r\n:::';
  for (const operation of [{ type: 'replaceParagraph', id: 'control', index: 0, text: 'A\nB\rC' }, { type: 'replaceDirectiveParagraph', id: 'N', index: 0, text: 'D\nE\rF' }]) {
    const plan = planOperation(parseDocument(input), operation); assert.deepEqual(plan.edits, []); assert.deepEqual(Buffer.from(plan.next.source), Buffer.from(input));
  }
});
test('sparse direct-JS arrays fail with a classified error and step index', () => {
  for (const bad of [
    { type: 'insertDirective', ...operationDefinitions.insertDirective.example, children: new Array(1) },
    { type: 'insertTable', sectionId: 'control', headers: new Array(1), rows: [] },
    { type: 'insertTable', sectionId: 'control', headers: ['A'], rows: [new Array(1)] },
  ]) {
    assert.throws(() => readOperation(bad), { code: 'NARU_ARGUMENT' });
    assert.throws(() => planSequence(parseDocument(source), [{ type: 'setHeadingTitle', id: 'control', title: 'Control' }, bad]), e => e.code === 'NARU_ARGUMENT' && e.operationIndex === 1);
  }
});
test('final-only sequence discards intermediate edit slices but retains global errors', () => {
  const doc = parseDocument(source), operations = Array.from({ length: 150 }, (_, i) => ({ type: 'setHeadingTitle', id: 'control', title: 'Control ' + i }));
  const plan = planSequence(doc, operations, { collectSteps: false });
  assert.deepEqual(plan.steps, []); assert.equal(plan.next.source, source.replace('Control  {#', 'Control 149  {#'));
  assert.throws(() => planSequence(doc, [...operations, { type: 'removeSection', id: 'missing' }], { collectSteps: false }), e => e.code === 'NARU_TARGET' && e.operationIndex === 150);
});
