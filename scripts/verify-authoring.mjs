import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'apps/cli/bin/narudoc.mjs');
const original = await readFile(join(root, 'examples/engineering.narudoc'));
const outputRoot = join(root, '.narudoc-scenarios');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'authoring-'));
const file = join(output, 'engineering.narudoc');
const transcript = [];
function run(args, status = 0) {
  const result = spawnSync(process.execPath, [bin, ...args, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  transcript.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, status, result.stderr || result.error?.message);
  return JSON.parse(status === 0 ? result.stdout : result.stderr);
}
async function edit(args, expected) {
  const before = await readFile(file);
  const revision = run(['inspect', file]).revision;
  const command = [...args, '--revision', revision];
  const preview = run([...command, '--dry-run']);
  assert.deepEqual(await readFile(file), before, 'dry-run must not write');
  const saved = run(command);
  assert.equal(saved.nextRevision, preview.nextRevision);
  assert.deepEqual(saved.edits, preview.edits);
  assert.deepEqual(await readFile(file), Buffer.from(expected), 'only intended source may change');
  assert.equal(run(['validate', file]).valid, true);
  return revision;
}

try {
  await writeFile(join(output, 'before.narudoc'), original);
  await writeFile(file, original);
  let expected = original.toString('utf8');
  const initial = run(['inspect', file]);
  assert.deepEqual(initial.diagnostics, []);
  assert.deepEqual(run(['outline', file]).sections.map(s => s.id),
    ['system-architecture', 'dc-link-control', 'validation']);
  const controlBefore = run(['get', file, '--id', 'dc-link-control']).source;
  expected = expected.replace('The target voltage is 400 V.', 'The target voltage is 420 V.');
  const stale = await edit(['paragraph', 'replace', file, '--id', 'dc-link-control',
    '--index', '0', '--text', 'The target voltage is 420 V.'], expected);

  const beforeConflict = await readFile(file);
  const conflict = run(['directive', 'set', file, '--id', 'REQ-001', '--key', 'status',
    '--value', 'reviewed', '--revision', stale], 4);
  assert.equal(conflict.error.code, 'NARU_STALE');
  assert.deepEqual(await readFile(file), beforeConflict);

  // The human's request still applies after re-reading the new snapshot.
  assert.match(run(['get', file, '--id', 'REQ-001']).source, /status: draft/);
  expected = expected.replace('status: draft', 'status: reviewed');
  await edit(['directive', 'set', file, '--id', 'REQ-001', '--key', 'status', '--value', 'reviewed'], expected);
  const control = controlBefore.replace('400 V.', '420 V.').replace('status: draft', 'status: reviewed');
  const controlStart = expected.indexOf('## DC-Link Control');
  const validationStart = expected.indexOf('## Validation');
  assert.equal(expected.slice(controlStart, validationStart), control);
  expected = expected.slice(0, controlStart) + expected.slice(validationStart) + control;
  await edit(['section', 'move', file, '--id', 'dc-link-control', '--after', 'validation'], expected);
  assert.equal(run(['get', file, '--id', 'dc-link-control']).source, control);
  assert.deepEqual(run(['outline', file]).sections.map(s => s.id),
    ['system-architecture', 'validation', 'dc-link-control']);

  const noop = run(['directive', 'set', file, '--id', 'REQ-001', '--key', 'status',
    '--value', 'reviewed', '--revision', run(['inspect', file]).revision]);
  assert.equal(noop.changed, false);
  assert.deepEqual(await readFile(file), Buffer.from(expected));
  const htmlPath = join(output, 'engineering.html');
  run(['render', file, '--to', 'html', '--output', htmlPath]);
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /420 V/);
  assert.match(html, /<dt>status<\/dt><dd>reviewed<\/dd>/);
  assert.match(html, /href="#REQ-001"/);
  assert.match(html, /id="REQ-001"/);
  assert.match(html, /<h2 id="validation"/);
  assert.match(html, /<h2 id="dc-link-control"/);
  assert.ok(html.indexOf('<h2 id="validation"') < html.indexOf('<h2 id="dc-link-control"'));
  const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-color',
    '--', join(output, 'before.narudoc'), file], { encoding: 'utf8', timeout: 10000 });
  assert.equal(diff.status, 1, diff.stderr || diff.error?.message);
  await writeFile(join(output, 'changes.diff'), diff.stdout);

  // The same request can now be planned and saved as one batch.
  const batchFile = join(output, 'batch.narudoc');
  await writeFile(batchFile, original);
  const batchRevision = run(['inspect', batchFile]).revision;
  const batchArgs = ['batch', batchFile, '--operations', join(root, 'examples/engineering-edit.json'), '--revision', batchRevision];
  const batchPreview = run([...batchArgs, '--dry-run']);
  assert.deepEqual(await readFile(batchFile), original);
  const batchSaved = run(batchArgs);
  assert.equal(batchSaved.nextRevision, batchPreview.nextRevision);
  assert.deepEqual(batchSaved.steps, batchPreview.steps);
  assert.deepEqual(await readFile(batchFile), await readFile(file));
  assert.equal(run(['validate', batchFile]).valid, true);
  const batchHtmlPath = join(output, 'batch.html');
  run(['render', batchFile, '--to', 'html', '--output', batchHtmlPath]);
  assert.equal(await readFile(batchHtmlPath, 'utf8'), html);

  const rejectedFile = join(output, 'rejected-batch.narudoc');
  const rejectedPlanFile = join(output, 'rejected-plan.json');
  await writeFile(rejectedFile, original);
  const rejectedPlan = JSON.parse(await readFile(join(root, 'examples/engineering-edit.json'), 'utf8'));
  rejectedPlan.operations.push({ type: 'removeSection', id: 'missing' });
  await writeFile(rejectedPlanFile, JSON.stringify(rejectedPlan));
  const rejected = run(['batch', rejectedFile, '--operations', rejectedPlanFile, '--revision', batchRevision], 2);
  assert.equal(rejected.error.code, 'NARU_TARGET');
  assert.equal(rejected.error.operationIndex, 3);
  assert.deepEqual(await readFile(rejectedFile), original);

  const renamedFile = join(output, 'renamed.narudoc');
  await writeFile(renamedFile, await readFile(batchFile));
  const renameArgs = ['id', 'rename', renamedFile, '--id', 'REQ-001', '--new-id', 'REQ-CTRL-001', '--revision', batchSaved.nextRevision];
  const renamePreview = run([...renameArgs, '--dry-run']);
  assert.equal(await readFile(renamedFile, 'utf8'), expected);
  const renamed = run(renameArgs);
  assert.equal(renamed.nextRevision, renamePreview.nextRevision);
  assert.equal(await readFile(renamedFile, 'utf8'), expected.replace('id: REQ-001', 'id: REQ-CTRL-001').replace('](#REQ-001)', '](#REQ-CTRL-001)'));
  assert.equal(run(['validate', renamedFile]).valid, true);
  const renamedHtml = run(['render', renamedFile, '--to', 'html']).html;
  assert.match(renamedHtml, /href="#REQ-CTRL-001"/);
  assert.match(renamedHtml, /id="REQ-CTRL-001"/);
  const paragraphFile = join(output, 'directive-paragraph.narudoc');
  await writeFile(paragraphFile, original);
  const paragraphRevision = run(['get', paragraphFile, '--id', 'REQ-001']).revision;
  const paragraphArgs = ['batch', paragraphFile, '--operations', join(root, 'examples/directive-paragraph-edit.json'), '--revision', paragraphRevision];
  const paragraphPreview = run([...paragraphArgs, '--dry-run']);
  assert.deepEqual(await readFile(paragraphFile), original);
  const paragraphSaved = run(paragraphArgs);
  assert.equal(paragraphSaved.nextRevision, paragraphPreview.nextRevision);
  assert.deepEqual(paragraphSaved.steps, paragraphPreview.steps);
  assert.deepEqual(await readFile(paragraphFile), Buffer.from(original.toString('utf8').replace(
    'The controller shall validate the requested operating mode.', 'The controller shall validate all inputs.')));
  assert.equal(run(['validate', paragraphFile]).valid, true);
  const paragraphHtmlPath = join(output, 'directive-paragraph.html');
  run(['render', paragraphFile, '--to', 'html', '--output', paragraphHtmlPath]);
  assert.match(await readFile(paragraphHtmlPath, 'utf8'), /<p>The controller shall validate all inputs\.<\/p>/);
  const newFile = join(output, 'new-document.narudoc');
  const created = run(['new', newFile, '--title', 'Control', '--id', 'control']);
  assert.equal(await readFile(newFile, 'utf8'), '# Control {#control}\n');
  const newArgs = ['batch', newFile, '--operations', join(root, 'examples/new-document-edit.json'), '--revision', created.revision];
  const newPreview = run([...newArgs, '--dry-run']);
  assert.equal(await readFile(newFile, 'utf8'), '# Control {#control}\n');
  const newSaved = run(newArgs);
  assert.deepEqual(newSaved.steps, newPreview.steps);
  assert.equal(newSaved.nextRevision, newPreview.nextRevision);
  assert.equal(await readFile(newFile, 'utf8'), '# Control {#control}\n\nThe controller validates all inputs.\n\nSee [control](#control).\n');
  assert.equal(run(['validate', newFile]).valid, true);
  const newHtmlPath = join(output, 'new-document.html');
  run(['render', newFile, '--to', 'html', '--output', newHtmlPath]);
  const newHtml = await readFile(newHtmlPath, 'utf8');
  assert.match(newHtml, /<p>The controller validates all inputs\.<\/p>/);
  assert.match(newHtml, /href="#control"/);
  const structuredFile = join(output, 'structured-document.narudoc');
  run(['new', structuredFile, '--title', 'Design', '--id', 'design']);
  run(['section', 'insert', structuredFile, '--after', 'design', '--id', 'control', '--title', 'Control']);
  run(['paragraph', 'insert', structuredFile, '--id', 'control', '--index', '0', '--text', 'Control description.']);
  const structuredBefore = await readFile(structuredFile);
  const structuredRevision = run(['inspect', structuredFile]).revision;
  const insertArgs = ['directive', 'insert', structuredFile, '--section', 'control', '--from', join(root, 'examples/requirement-input.json'), '--revision', structuredRevision];
  const insertPreview = run([...insertArgs, '--dry-run']);
  assert.deepEqual(await readFile(structuredFile), structuredBefore);
  const insertSaved = run(insertArgs);
  assert.deepEqual(insertSaved.edits, insertPreview.edits);
  assert.equal(insertSaved.nextRevision, insertPreview.nextRevision);
  assert.deepEqual(run(['get', structuredFile, '--id', 'REQ-DC-001']).node.children.map(c => c.type), ['paragraph', 'list', 'code']);
  run(['directive', 'set', structuredFile, '--id', 'REQ-DC-001', '--key', 'status', '--value', 'reviewed']);
  run(['directive', 'replace-paragraph', structuredFile, '--id', 'REQ-DC-001', '--index', '0', '--text', 'The controller validates all inputs. See [this requirement](#REQ-DC-001).']);
  run(['id', 'rename', structuredFile, '--id', 'REQ-DC-001', '--new-id', 'REQ-CTRL-001']);
  assert.equal(run(['validate', structuredFile]).valid, true);
  assert.match(await readFile(structuredFile, 'utf8'), /status: reviewed/);
  const structuredHtmlPath = join(output, 'structured-document.html');
  run(['render', structuredFile, '--to', 'html', '--output', structuredHtmlPath]);
  const structuredHtml = await readFile(structuredHtmlPath, 'utf8');
  assert.match(structuredHtml, /href="#REQ-CTRL-001"/);
  assert.match(structuredHtml, /The controller validates all inputs/);
  assert.match(structuredHtml, /<ul>/); assert.match(structuredHtml, /<pre><code>/);
  assert.match(structuredHtml, /\[literal\]\(#missing\)/);
  assert.deepEqual(await readFile(join(root, 'examples/engineering.narudoc')), original);
  console.log(`PASS: authoring scenario; artifacts: ${output}`);
} finally {
  await writeFile(join(output, 'commands.json'), JSON.stringify(transcript, null, 2) + '\n');
}
