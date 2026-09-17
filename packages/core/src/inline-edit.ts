import { NaruError, boundary, wellFormed, type DocumentSnapshot, type Inline, type SetInlineTextOperation } from '@naruforge/narudoc-model';
import { textTarget } from './query.js';
import { minimalEdit } from './patch.js';

function inlineSlot(nodes: Inline[], path: string): { nodes: Inline[]; index: number } {
  if (typeof path !== 'string' || !/^\d+(?:\.\d+)*$/.test(path)) throw new NaruError('NARU_ARGUMENT', 'Inline path must be dot-separated indices.');
  let node: Inline | undefined;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const index = Number(parts[i]);
    if (!Number.isSafeInteger(index) || index > nodes.length) throw new NaruError('NARU_TARGET', 'Inline path not found.');
    if (i === parts.length - 1) return { nodes, index };
    node = nodes[index];
    if (!node) throw new NaruError('NARU_TARGET', 'Inline path not found.');
    if (i < parts.length - 1) {
      if (node.type !== 'strong' && node.type !== 'emphasis') throw new NaruError('NARU_ARGUMENT', 'Only ordinary text and emphasis/strong text may be edited.');
      nodes = node.children;
    }
  }
  throw new NaruError('NARU_ARGUMENT', 'Empty inline path.');
}
export function inlineTextEdits(doc: DocumentSnapshot, op: SetInlineTextOperation) {
  const block = textTarget(doc, op), slot = inlineSlot(block.inline, op.path), leaf = slot.nodes[slot.index];
  if (typeof op.text !== 'string' || !wellFormed(op.text) || /[\x00-\x1f\x7f]/.test(op.text)) throw new NaruError('NARU_ARGUMENT', 'Text must be single-line Unicode.');
  // An empty expected value denotes a semantic gap before this inline index (length = end).
  // This also lets history restore a text run removed by a prior operation.
  if (op.expected === '') {
    const point = leaf?.range?.start ?? slot.nodes[slot.index - 1]?.range?.end;
    if (point === undefined) throw new NaruError('NARU_TARGET', 'Inline gap has no source boundary.');
    return minimalEdit(doc.source, point, point, op.text);
  }
  if (!leaf) throw new NaruError('NARU_TARGET', 'Inline path not found.');
  if (leaf.type !== 'text' || !leaf.range || doc.source.slice(leaf.range.start, leaf.range.end) !== leaf.value) throw new NaruError('NARU_ARGUMENT', 'Protected inline text; escape/code/link editing is unsupported.');
  if (leaf.value !== op.expected) throw new NaruError('NARU_STALE', 'Inline mapping no longer matches the snapshot.');
  if (!boundary(doc.source, leaf.range.start) || !boundary(doc.source, leaf.range.end)) throw new NaruError('NARU_PATCH', 'Invalid inline range.');
  return minimalEdit(doc.source, leaf.range.start, leaf.range.end, op.text);
}
function shape(nodes: Inline[]): unknown {
  const normalized: Inline[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && !node.value) continue;
    const last = normalized.at(-1);
    if (node.type === 'text' && last?.type === 'text') last.value += node.value;
    else normalized.push({ ...node });
  }
  return normalized.map(n => 'value' in n ? { type: n.type, value: n.value } : { type: n.type, ...('url' in n ? { url: n.url } : {}), children: shape(n.children) });
}
export function assertInlineResult(before: DocumentSnapshot, after: DocumentSnapshot, op: SetInlineTextOperation) {
  const original = textTarget(before, op), result = textTarget(after, op);
  const expected = JSON.parse(JSON.stringify(original.inline)) as Inline[];
  const slot = inlineSlot(expected, op.path), leaf = slot.nodes[slot.index];
  if (op.expected === '') slot.nodes.splice(slot.index, 0, { type: 'text', value: op.text });
  else {
    if (leaf?.type !== 'text') throw new NaruError('NARU_ARGUMENT', 'Expected ordinary text.');
    leaf.value = op.text;
  }
  if (before.blocks.length !== after.blocks.length || JSON.stringify(shape(expected)) !== JSON.stringify(shape(result.inline))) throw new NaruError('NARU_ARGUMENT', 'Edit changes markup or block structure; draft remains uncommitted.');
}
