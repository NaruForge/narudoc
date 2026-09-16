import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SourceSession } from '../../packages/editor-adapter/dist/session.js';
import { parseDocument, planSequence } from '../../packages/core/dist/index.js';
const require = createRequire(new URL('../../packages/editor-adapter/package.json', import.meta.url));
const { Schema } = require('prosemirror-model');
const { EditorState, TextSelection } = require('prosemirror-state');
const { history, undo, redo } = require('prosemirror-history');

const source = '\uFEFF# Control  {#control}\r\n\r\nA.\r\n\r\nB.\r\n';
const target = index => ({ kind: 'paragraph', id: 'control', index });
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
const paragraph = text => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const state = texts => EditorState.create({ schema, doc: schema.nodes.doc.create(null, texts.map(paragraph)), plugins: [history()] });

/** Same plain two-paragraph task, real PM state/selection/transactions/history in both topologies.
 * This is an in-memory proof: no native selection gesture, OS IME, split/join or production UI claim.
 */
export function topologyProof(topology) {
  const session = new SourceSession(source, { revision: 'disk-base', historyLimit: 100 });
  let states = topology === 'single' ? [state(['A.', 'B.'])] : [state(['A.']), state(['B.'])];
  let notifications = 0; session.listeners.add(() => notifications++);
  const texts = list => topology === 'single' ? [list[0].doc.child(0).textContent, list[0].doc.child(1).textContent] : list.map(s => s.doc.child(0).textContent);
  const edit = (values, list = states) => {
    if (topology === 'single') {
      let tr = list[0].tr;
      // PM positions belong only to this projection, mapped through its own transaction.
      let pos = 0;
      list[0].doc.forEach((node, offset, i) => {
        pos = tr.mapping.map(offset + 1);
        tr.insertText(values[i], pos, tr.mapping.map(offset + 1 + node.content.size));
      });
      return [list[0].apply(tr)];
    }
    return list.map((s, i) => s.apply(s.tr.insertText(values[i], 1, 1 + s.doc.child(0).content.size)));
  };
  const commit = candidate => {
    const before = texts(states), after = texts(candidate);
    const operations = after.map((text, index) => ({ type: 'setInlineText', ...target(index), path: '0', expected: before[index], text }));
    session.gesture(operations); states = candidate;
  };
  if (topology === 'single') states[0] = states[0].apply(states[0].tr.setSelection(TextSelection.create(states[0].doc, 1, 7)));
  else {
    states[0] = states[0].apply(states[0].tr.setSelection(TextSelection.create(states[0].doc, 1, 3)));
    states[1] = states[1].apply(states[1].tr.setSelection(TextSelection.create(states[1].doc, 1, 3)));
  }
  session.select({ target: target(0), offset: 0 }, { target: target(1), offset: 2 });
  assert.deepEqual([session.selection.anchor.target.index, session.selection.head.target.index], [0, 1]);
  const originalStates = states;
  commit(edit(['A changed.', 'B changed.']));
  const expected = '\uFEFF# Control  {#control}\r\n\r\nA changed.\r\n\r\nB changed.\r\n';
  assert.equal(session.source, expected); assert.equal(notifications, 1);
  assert.equal(planSequence(parseDocument(source), session.operations).next.source, expected);
  // Actual PM history agrees with the coordinator's one user-gesture history entry.
  states = states.map(s => { let result; assert.equal(undo(s, tr => { result = s.apply(tr); }), true); return result; });
  assert.deepEqual(texts(states), ['A.', 'B.']); session.undoGesture(); assert.equal(session.source, source);
  states = states.map(s => { let result; assert.equal(redo(s, tr => { result = s.apply(tr); }), true); return result; });
  assert.deepEqual(texts(states), ['A changed.', 'B changed.']); session.redoGesture(); assert.equal(session.source, expected);
  // Empty input is a PM draft and never a placeholder sentence on disk.
  const empty = edit(['', 'B changed.']); assert.equal(texts(empty)[0], '');
  session.drafts.set('paragraph-0', ''); assert.equal(session.valid, false); assert.equal(session.source, expected); session.drafts.clear();
  const beforeFailure = states, generation = session.generation, log = session.operations, count = notifications;
  assert.throws(() => commit(edit(['First succeeded locally.', '[broken](#missing)'])), e => e.operationIndex === 1);
  assert.equal(states, beforeFailure); assert.equal(session.generation, generation); assert.equal(notifications, count);
  assert.deepEqual(session.operations, log); assert.equal(session.source, expected);
  const oldEpoch = session.epoch;
  session.apply({ type: 'insertParagraph', id: 'control', index: 0, text: 'A changed.' });
  assert.ok(session.epoch > oldEpoch); assert.equal(session.selection, null);
  assert.throws(() => session.select({ target: target(1), offset: 0 }, undefined, generation, oldEpoch), { code: 'NARU_STALE' });
  assert.equal(originalStates[0].doc.child(0).textContent, 'A.');
  return { topology, views: topology === 'single' ? 1 : 2, nativeCrossParagraphSelection: topology === 'single', pmHistoryDispatchesPerCompoundUndo: topology === 'single' ? 1 : 2, fidelity: true, atomicFailure: true, emptyDraft: true, staleSelectionRejected: true };
}
