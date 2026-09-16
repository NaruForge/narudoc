import { NaruError, boundary, wellFormed, type DocumentSnapshot, type Inline, type TextTarget, type SetInlineTextOperation } from '@naruforge/narudoc-model';
import { getById, getSection } from './query.js';
import { minimalEdit } from './patch.js';

export function textTarget(doc: DocumentSnapshot, target: TextTarget) {
  if (!Number.isSafeInteger(target.index) || target.index < 0) throw new NaruError('NARU_ARGUMENT', 'Text target index must be a non-negative safe integer.');
  if (target.kind === 'heading') {
    if (target.index !== 0) throw new NaruError('NARU_ARGUMENT', 'Heading index must be zero.');
    return getSection(doc, target.id).heading;
  }
  if (target.kind === 'directiveParagraph') {
    const node = getById(doc, target.id);
    if (node.type !== 'directive') throw new NaruError('NARU_TARGET', 'Expected directive.');
    const paragraph = node.children.filter(b => b.type === 'paragraph')[target.index];
    if (!paragraph) throw new NaruError('NARU_TARGET', 'Paragraph index is out of range.');
    return paragraph;
  }
  if (target.kind !== 'paragraph') throw new NaruError('NARU_ARGUMENT', 'Unknown text target kind.');
  const section = getSection(doc, target.id);
  const paragraphs = [];
  for (const block of doc.blocks.slice(doc.blocks.indexOf(section.heading) + 1)) {
    if (block.type === 'heading') break;
    if (block.type === 'paragraph') paragraphs.push(block);
  }
  const paragraph = paragraphs[target.index];
  if (!paragraph) throw new NaruError('NARU_TARGET', 'Paragraph index is out of range.');
  return paragraph;
}
export function inlineLeaf(nodes: Inline[], path: string): Inline {
  if (typeof path !== 'string' || !/^\d+(?:\.\d+)*$/.test(path)) throw new NaruError('NARU_ARGUMENT', 'Inline path must be dot-separated indices.');
  let node: Inline | undefined;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    node = nodes[Number(parts[i])];
    if (!node) throw new NaruError('NARU_TARGET', 'Inline path not found.');
    if (i < parts.length - 1) {
      if (node.type !== 'strong' && node.type !== 'emphasis') throw new NaruError('NARU_ARGUMENT', 'Only ordinary text and emphasis/strong text may be edited.');
      nodes = node.children;
    }
  }
  return node!;
}
export function inlineTextEdits(doc: DocumentSnapshot, op: SetInlineTextOperation) {
  const block = textTarget(doc, op), leaf = inlineLeaf(block.inline, op.path);
  if (leaf.type !== 'text' || !leaf.range || doc.source.slice(leaf.range.start, leaf.range.end) !== leaf.value) throw new NaruError('NARU_ARGUMENT', 'Protected inline text; escape/code/link editing is unsupported.');
  if (leaf.value !== op.expected) throw new NaruError('NARU_STALE', 'Inline mapping no longer matches the snapshot.');
  if (typeof op.text !== 'string' || !wellFormed(op.text) || /[\x00-\x1f\x7f]/.test(op.text)) throw new NaruError('NARU_ARGUMENT', 'Text must be single-line Unicode.');
  if (!boundary(doc.source, leaf.range.start) || !boundary(doc.source, leaf.range.end)) throw new NaruError('NARU_PATCH', 'Invalid inline range.');
  return minimalEdit(doc.source, leaf.range.start, leaf.range.end, op.text);
}
function shape(nodes: Inline[]): unknown {
  return nodes.filter(n => n.type !== 'text' || n.value !== '').map(n => 'value' in n ? { type: n.type, value: n.value } : { type: n.type, ...('url' in n ? { url: n.url } : {}), children: shape(n.children) });
}
export function assertInlineResult(before: DocumentSnapshot, after: DocumentSnapshot, op: SetInlineTextOperation) {
  const original = textTarget(before, op), result = textTarget(after, op);
  const expected = JSON.parse(JSON.stringify(original.inline)) as Inline[];
  const leaf = inlineLeaf(expected, op.path);
  if (leaf.type !== 'text') throw new NaruError('NARU_ARGUMENT', 'Expected ordinary text.');
  leaf.value = op.text;
  if (before.blocks.length !== after.blocks.length || JSON.stringify(shape(expected)) !== JSON.stringify(shape(result.inline))) throw new NaruError('NARU_ARGUMENT', 'Edit changes markup or block structure; draft remains uncommitted.');
}
