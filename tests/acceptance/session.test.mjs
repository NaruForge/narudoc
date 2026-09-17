import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceSession } from '../../packages/editor-adapter/dist/session.js';
import { parseDocument, planBatch, planSequence, textTarget, textTargets, targetMetadata, getTable, directSectionBody, validateDocument } from '../../packages/core/dist/index.js';

const source = '\uFEFF# Control  {#control}\r\n\r\nA.\r\n\r\nB.\r\n';
const target = index => ({ kind: 'paragraph', id: 'control', index });
const text = (index, expected, value) => ({ type: 'setInlineText', ...target(index), path: '0', expected, text: value });

test('pure session exposes owned operations, distinct source/draft/revision and atomic gestures', () => {
  const session = new SourceSession(source, { revision: 'disk-r1', historyLimit: 100 }); let published = 0;
  session.listeners.add(() => published++);
  session.select({ target: target(0), offset: 1 }, { target: target(1), offset: 1 });
  const selection = session.selection, generation = session.generation;
  session.drafts.set('new-paragraph', '');
  assert.equal(session.valid, false); assert.equal(session.source, source); assert.equal(session.baseSource, source);
  assert.throws(() => session.gesture([text(0, 'A.', 'A changed.'), text(1, 'not B.', 'Bad')]), e => e.operationIndex === 1 && e.code === 'NARU_STALE');
  assert.equal(session.source, source); assert.equal(session.generation, generation); assert.equal(published, 0);
  assert.deepEqual(session.selection, selection); assert.deepEqual(session.operations, []); assert.equal(session.canUndo, false);
  assert.equal(session.drafts.get('new-paragraph'), ''); session.drafts.clear();
  session.gesture([text(0, 'A.', 'A changed.'), text(1, 'B.', 'B changed.')]);
  const changed = source.replace('A.', 'A changed.').replace('B.', 'B changed.');
  assert.equal(session.source, changed); assert.equal(published, 1); assert.equal(session.diskRevision, 'disk-r1');
  session.select({ target: target(1), offset: 2 });
  assert.equal(session.undoGesture(), true); assert.equal(session.source, source); assert.equal(session.selection.anchor.offset, 1);
  assert.equal(session.redoGesture(), true); assert.equal(session.source, changed); assert.equal(session.selection.anchor.offset, 2);
  assert.equal(planSequence(parseDocument(session.baseSource), session.operations).next.source, changed);
  const exported = session.operations; exported[0].text = 'mutated';
  assert.equal(planSequence(parseDocument(session.baseSource), session.operations).next.source, changed);
});
test('selection lifetime rejects stale generations/structure and surrogate splits', () => {
  const session = new SourceSession(source.replace('A.', 'A😀.'));
  assert.throws(() => session.select({ target: target(0), offset: 2 }), { code: 'NARU_TARGET' });
  session.select({ target: target(0), offset: 3 }); const old = session.selection;
  session.apply({ type: 'insertParagraph', id: 'control', index: 0, text: 'A😀.' });
  assert.equal(session.selection, null); assert.ok(session.epoch > old.epoch);
  assert.throws(() => session.select(old.anchor, old.head, old.generation, old.epoch), { code: 'NARU_STALE' });
  assert.throws(() => session.apply(text(1, 'A😀.', 'wrong target'), old.generation), { code: 'NARU_STALE' });
  session.replace(session.source, 'disk-r2'); assert.equal(session.diskRevision, 'disk-r2'); assert.equal(session.canUndo, false);
});
test('same-run coalescing preserves exact bytes, independent gesture undo and save replay', () => {
  const compact = new SourceSession(source, { historyLimit: 100 }), raw = new SourceSession(source, { coalesce: false });
  let prior = 'A.';
  for (let i = 0; i < 80; i++) {
    const value = 'A.' + '한😀'.repeat(i + 1), operation = text(0, prior, value);
    compact.apply(operation); raw.apply(operation); operation.text = 'caller mutation'; prior = value;
  }
  const expected = source.replace('A.', 'A.' + '한😀'.repeat(80));
  assert.deepEqual(Buffer.from(compact.source), Buffer.from(expected)); assert.equal(compact.source, raw.source);
  assert.equal(compact.operations.length, 1); assert.equal(raw.operations.length, 80);
  assert.equal(planSequence(parseDocument(source), compact.operations).next.source, expected);
  assert.deepEqual(validateDocument(compact.snapshot), validateDocument(raw.snapshot));
  compact.undoGesture(); assert.equal(compact.source, source.replace('A.', 'A.' + '한😀'.repeat(79)));
  compact.redoGesture(); assert.equal(compact.source, expected);
  assert.equal(planSequence(parseDocument(source), compact.operations).next.source, expected);
});
test('coalescing never crosses target, structural/rename/rebase or incompatible markup boundaries', () => {
  const session = new SourceSession(source);
  session.apply(text(0, 'A.', 'AA.')); session.apply(text(1, 'B.', 'BB.')); session.apply(text(0, 'AA.', 'AAA.'));
  assert.equal(session.operations.length, 3);
  session.apply({ type: 'insertParagraph', id: 'control', index: 0, text: 'X.' });
  session.apply(text(1, 'AAA.', 'AAAA.')); assert.equal(session.operations.length, 5);
  session.apply({ type: 'renameId', id: 'control', newId: 'renamed' });
  session.apply({ ...text(1, 'AAAA.', 'AAAAA.'), id: 'renamed' }); assert.equal(session.operations.length, 7);
  assert.equal(planSequence(parseDocument(source), session.operations).next.source, session.source);
  const beforeSave = session.source; session.replace(beforeSave, 'next-revision');
  session.apply({ ...text(1, 'AAAAA.', 'AAAAAA.'), id: 'renamed' }); assert.equal(session.operations.length, 1);
  assert.equal(planSequence(parseDocument(beforeSave), session.operations).next.source, session.source);
  const markup = new SourceSession('# H {#control}\n\nplain **bold** tail');
  markup.apply(text(0, 'plain ', '')); markup.apply(text(0, '', 'restored '));
  assert.equal(markup.source, '# H {#control}\n\nrestored **bold** tail');
  assert.equal(planSequence(parseDocument(markup.baseSource), markup.operations).next.source, markup.source);
});
test('nested authored DTO remains session-owned after caller mutation', () => {
  const session = new SourceSession(source), operation = { type: 'insertDirective', sectionId: 'control', name: 'note', id: 'N', attributes: { status: 'draft' }, children: [{ type: 'paragraph', text: 'Owned.' }] };
  session.apply(operation); const expected = session.source;
  operation.children[0].text = 'Changed externally'; operation.attributes.status = 'oops';
  assert.equal(planSequence(parseDocument(source), session.operations).next.source, expected);
});
test('shared target resolvers preserve section/directive/table index boundaries and expose authoring metadata', () => {
  const doc = parseDocument('# Control {#control}\n\nA.\n\n- list\n\n| A |\n| --- |\n| B |\n\n:::note\nid: N\n\nD.\n\n- list\n\nE.\n:::\n\nB.\n\n## Child {#child}\n\nC.');
  assert.equal(directSectionBody(doc, 'control').blocks.length, 5);
  assert.equal(textTarget(doc, target(1)).inline[0].value, 'B.'); assert.equal(getTable(doc, 'control', 0).type, 'table');
  assert.equal(textTarget(doc, { kind: 'directiveParagraph', id: 'N', index: 1 }).inline[0].value, 'E.');
  assert.throws(() => textTarget(doc, target(2)), { code: 'NARU_TARGET' });
  for (const item of textTargets(doc)) assert.equal(textTarget(doc, item.target), item.block);
  assert.deepEqual(targetMetadata(doc, 'N').map(t => [t.operation, t.index, t.text]), [['replaceDirectiveParagraph', 0, 'D.'], ['replaceDirectiveParagraph', 1, 'E.']]);
});
test('batch indices refer to each preceding result, independently of external disk revision', () => {
  const insert = { type: 'insertParagraph', id: 'control', index: 0, text: 'X.' };
  const atOne = planBatch(parseDocument(source), { schemaVersion: 1, operations: [insert, { type: 'replaceParagraph', id: 'control', index: 1, text: 'A changed.' }] });
  assert.equal(atOne.next.source, '\uFEFF# Control  {#control}\r\n\r\nX.\r\n\r\nA changed.\r\n\r\nB.\r\n');
  const atTwo = planBatch(parseDocument(source), { schemaVersion: 1, operations: [insert, { type: 'replaceParagraph', id: 'control', index: 2, text: 'B changed.' }] });
  assert.equal(atTwo.next.source, '\uFEFF# Control  {#control}\r\n\r\nX.\r\n\r\nA.\r\n\r\nB changed.\r\n');
  assert.throws(() => planBatch(parseDocument(source), { schemaVersion: 1, operations: [insert, text(1, 'B.', 'Wrong.')] }), e => e.code === 'NARU_STALE' && e.operationIndex === 1);
});

test('save acknowledgement rebases semantic journal without discarding document undo/redo', () => {
  const session = new SourceSession(source, { revision: 'disk-r1', historyLimit: 20 });
  session.apply(text(0, 'A.', 'A changed.'));
  const saved = session.source;
  session.acknowledgeSave(saved, 'disk-r2');
  assert.equal(session.baseSource, saved); assert.equal(session.diskRevision, 'disk-r2'); assert.equal(session.operations.length, 0); assert.equal(session.canUndo, true);
  assert.equal(session.undoGesture(), true); assert.equal(session.source, source);
  assert.equal(planSequence(parseDocument(saved), session.operations).next.source, source);
  assert.equal(session.redoGesture(), true); assert.equal(session.source, saved);
  assert.equal(planSequence(parseDocument(saved), session.operations).next.source, saved);
});

test('split, join and boundary insertion replay exactly after save undo and redo', () => {
  const cases = [
    ['# Control {#control}\n\nAlpha.', { type: 'splitParagraph', id: 'control', index: 0, offset: 2, expected: 'Alpha.' }],
    ['# Control {#control}\n\nA.\n\nB.', { type: 'joinParagraph', id: 'control', index: 0, expected: 'A.\nB.' }],
    ['# Control {#control}\n\nA.', { type: 'insertParagraph', id: 'control', index: 1, text: 'Tail' }],
  ];
  for (const [original, operation] of cases) {
    const session = new SourceSession(original, { revision: 'disk-r1', historyLimit: 20 });
    session.apply(operation); const saved = session.source;
    session.acknowledgeSave(saved, 'disk-r2');
    assert.equal(session.undoGesture(), true); assert.equal(session.source, original);
    assert.equal(planSequence(parseDocument(saved), session.operations).next.source, session.source);
    assert.equal(session.redoGesture(), true); assert.equal(session.source, saved);
    assert.equal(planSequence(parseDocument(saved), session.operations).next.source, session.source);
  }
});

test('operations without a byte-exact inverse are explicit document history barriers', () => {
  const cases = [
    [source, { type: 'insertDirective', sectionId: 'control', name: 'note', id: 'N', attributes: {}, children: [{ type: 'paragraph', text: 'Note.' }] }],
    ['# Control {#control}\n\nA.\n\n:::note\nid: N\n\nNote.\n:::', { type: 'setDirectiveAttribute', id: 'N', key: 'status', value: 'draft' }],
  ];
  for (const [original, operation] of cases) {
    const session = new SourceSession(original, { revision: 'disk-r1', historyLimit: 20 });
    session.apply(text(0, 'A.', 'Changed.')); assert.equal(session.canUndo, true);
    session.apply(operation); assert.equal(session.canUndo, false); assert.equal(session.canRedo, false);
    const saved = session.source; session.acknowledgeSave(saved, 'disk-r2');
    assert.equal(session.canUndo, false); assert.deepEqual(session.operations, []);
  }
});

test('history rollover preserves saved-base replay when a full checkpoint loses its oldest gesture', () => {
  const original = '# Control {#control}\n\nA';
  const replace = (expected, value) => ({ type: 'replaceParagraphRange', id: 'control', from: { index: 0, offset: 0 }, to: { index: 0, offset: expected.length }, expected, text: value });
  const session = new SourceSession(original, { revision: 'disk-r1', historyLimit: 2 });
  session.apply(replace('A', 'B')); session.apply(replace('B', 'C'));
  const saved = session.source; session.acknowledgeSave(saved, 'disk-r2');
  session.apply(replace('C', 'D'));
  assert.equal(planSequence(parseDocument(saved), session.operations).next.source, session.source);
  assert.equal(session.undoGesture(), true); assert.equal(session.source, saved); assert.deepEqual(session.operations, []);
  assert.equal(session.redoGesture(), true); assert.equal(session.source, '# Control {#control}\n\nD');
  assert.equal(planSequence(parseDocument(saved), session.operations).next.source, session.source);
});
