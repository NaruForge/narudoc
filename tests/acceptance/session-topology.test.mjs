import test from 'node:test';
import assert from 'node:assert/strict';
import { topologyProof } from '../proofs/session-topology.mjs';
test('single-document and multi-view coordinator execute the same two-paragraph PM proof', () => {
  const single = topologyProof('single'), multiple = topologyProof('multiple');
  assert.equal(single.nativeCrossParagraphSelection, true); assert.equal(multiple.nativeCrossParagraphSelection, false);
  assert.equal(single.pmHistoryDispatchesPerCompoundUndo, 1); assert.equal(multiple.pmHistoryDispatchesPerCompoundUndo, 2);
});
