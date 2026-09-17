import { ID_PATTERN, NaruError, boundary, wellFormed, type DocumentSnapshot, type Inline, type Operation, type TextEdit } from '@naruforge/narudoc-model';
import { getById, getTable, textTarget } from './query.js';
import { minimalEdit } from './patch.js';

export function captionValue(value: string): void {
  if (!wellFormed(value) || /[\x00-\x1f\x7f]/.test(value)) throw new NaruError('NARU_ARGUMENT', 'Caption must be plain single-line Unicode.');
}
export function annotationSource(id: string, caption?: string): string {
  if (!ID_PATTERN.test(id)) throw new NaruError('NARU_ARGUMENT', 'Invalid table ID.');
  if (caption !== undefined) captionValue(caption);
  return `@table id=${JSON.stringify(id)}${caption ? ` caption=${JSON.stringify(caption)}` : ''}`;
}
export function tableMetadataEdits(doc: DocumentSnapshot, op: Extract<Operation, { type: 'setTableMetadata' }>): TextEdit[] {
  const table = getTable(doc, op.sectionId, op.tableIndex);
  if (op.id === undefined && op.caption === undefined) throw new NaruError('NARU_ARGUMENT', 'Provide id or caption.');
  if (table.id !== undefined && op.id !== undefined && op.id !== table.id) throw new NaruError('NARU_ARGUMENT', 'Use renameId to change a table ID.');
  const id = table.id ?? op.id;
  if (id === undefined) throw new NaruError('NARU_ARGUMENT', 'A caption requires a table ID.');
  annotationSource(id, op.caption);
  if (!table.annotationRange) return [{ start: table.range.start, end: table.range.start, expected: '', text: annotationSource(id, op.caption) + doc.eol }];
  if (op.caption === undefined || (op.caption !== '' && op.caption === table.caption) || (!op.caption && table.caption === undefined)) return [];
  if (op.caption === '' && table.captionAttributeRange) return minimalEdit(doc.source, table.captionAttributeRange.start, table.captionAttributeRange.end, '');
  if (table.captionRange) return minimalEdit(doc.source, table.captionRange.start, table.captionRange.end, JSON.stringify(op.caption));
  const point = table.annotationRange.end;
  return [{ start: point, end: point, expected: '', text: ` caption=${JSON.stringify(op.caption)}` }];
}
function slot(nodes: Inline[], path: string): { nodes: Inline[]; index: number } {
  if (!/^\d+(?:\.\d+)*$/.test(path)) throw new NaruError('NARU_ARGUMENT', 'Invalid inline path.');
  const parts = path.split('.').map(Number);
  for (const [position, index] of parts.entries()) {
    if (!Number.isSafeInteger(index) || index > nodes.length) throw new NaruError('NARU_TARGET', 'Inline path not found.');
    if (position === parts.length - 1) return { nodes, index };
    const node = nodes[index];
    if (!node || (node.type !== 'strong' && node.type !== 'emphasis')) throw new NaruError('NARU_ARGUMENT', 'Cannot enter protected inline content.');
    nodes = node.children;
  }
  throw new NaruError('NARU_TARGET', 'Inline path not found.');
}
type ReferenceOperation = Extract<Operation, { type: 'insertReference' | 'setReferenceTarget' }>;
function normalized(nodes: Inline[]): unknown[] {
  const result: any[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.value) continue;
      if (result.at(-1)?.type === 'text') result.at(-1).value += node.value;
      else result.push({ type: 'text', value: node.value });
    } else if (node.type === 'reference') result.push({ type: node.type, targetId: node.targetId });
    else if (node.type === 'code') result.push({ type: node.type, value: node.value });
    else if ('children' in node) result.push({ type: node.type, ...(node.type === 'link' ? { url: node.url } : {}), children: normalized(node.children) });
  }
  return result;
}
export function referenceEdits(doc: DocumentSnapshot, op: ReferenceOperation): { edits: TextEdit[]; expected: Inline[] } {
  const target = getById(doc, op.targetId);
  if (target.type !== 'table') throw new NaruError('NARU_ARGUMENT', 'Semantic reference target must be a table.');
  const block = textTarget(doc, { kind: 'paragraph', id: op.id, index: op.index });
  const expected = JSON.parse(JSON.stringify(block.inline)) as Inline[], selected = slot(expected, op.path), leaf = selected.nodes[selected.index];
  if (op.type === 'setReferenceTarget') {
    if (leaf?.type !== 'reference' || !leaf.targetRange) throw new NaruError('NARU_TARGET', 'Expected semantic reference.');
    if (leaf.targetId !== op.expectedTargetId) throw new NaruError('NARU_STALE', 'Reference target changed.');
    if (doc.source.slice(leaf.targetRange.start, leaf.targetRange.end) !== leaf.targetId) throw new NaruError('NARU_PATCH', 'Reference range does not match source.');
    leaf.targetId = op.targetId;
    return { edits: minimalEdit(doc.source, leaf.targetRange.start, leaf.targetRange.end, op.targetId), expected };
  }
  let point: number;
  const reference: Inline = { type: 'reference', targetId: op.targetId };
  if (op.expected === '') {
    if (op.offset !== 0) throw new NaruError('NARU_ARGUMENT', 'Gap offset must be zero.');
    const boundary = leaf?.range?.start ?? selected.nodes[selected.index - 1]?.range?.end;
    if (boundary === undefined) throw new NaruError('NARU_TARGET', 'Gap has no source boundary.');
    point = boundary; selected.nodes.splice(selected.index, 0, reference);
  } else {
    if (leaf?.type !== 'text' || !leaf.range || doc.source.slice(leaf.range.start, leaf.range.end) !== leaf.value) throw new NaruError('NARU_ARGUMENT', 'Expected ordinary unescaped text.');
    if (leaf.value !== op.expected) throw new NaruError('NARU_STALE', 'Inline text changed.');
    if (!boundary(leaf.value, op.offset)) throw new NaruError('NARU_ARGUMENT', 'Invalid text offset.');
    point = leaf.range.start + op.offset;
    selected.nodes.splice(selected.index, 1, { type: 'text', value: leaf.value.slice(0, op.offset) }, reference, { type: 'text', value: leaf.value.slice(op.offset) });
  }
  return { edits: [{ start: point, end: point, expected: '', text: `[@${op.targetId}]` }], expected };
}
export function assertReferenceResult(before: DocumentSnapshot, after: DocumentSnapshot, op: ReferenceOperation, expected: Inline[]): void {
  const block = textTarget(after, { kind: 'paragraph', id: op.id, index: op.index });
  if (before.blocks.length !== after.blocks.length || JSON.stringify(normalized(block.inline)) !== JSON.stringify(normalized(expected))) throw new NaruError('NARU_ARGUMENT', 'Reference edit changed surrounding structure.');
}
