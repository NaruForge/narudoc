import { assetPathProblem, ID_PATTERN, NaruError, wellFormed, type DocumentSnapshot, type Operation, type TextEdit } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';
import { getById } from './query.js';
import { minimalEdit } from './patch.js';
import { captionValue } from './reference-edit.js';

export type FigureInput = { id: string; src: string; alt: string; caption?: string };

function altText(value: string): void {
  if (!wellFormed(value) || /[\x00-\x1f\x7f]/.test(value) || value !== value.trim()) throw new NaruError('NARU_ARGUMENT', 'Alt text must be a trimmed single-line Unicode string; empty is allowed only as an explicit decorative choice.');
}
function figureFields(input: FigureInput): void {
  if (!ID_PATTERN.test(input.id)) throw new NaruError('NARU_ARGUMENT', `Invalid ID: ${input.id}`);
  const problem = assetPathProblem(input.src);
  if (problem) throw new NaruError('NARU_ARGUMENT', problem);
  altText(input.alt);
  if (input.caption !== undefined) captionValue(input.caption);
}
/** Serializes a new @figure line and proves the parser reads back the same fields. */
export function figureSource(input: FigureInput): string {
  figureFields(input);
  const line = `@figure id=${JSON.stringify(input.id)} src=${JSON.stringify(input.src)} alt=${JSON.stringify(input.alt)}${input.caption ? ` caption=${JSON.stringify(input.caption)}` : ''}`;
  const parsed = parseDocument(`# V {#v}\n\n${line}\n`);
  const figure = parsed.blocks[1];
  if (parsed.diagnostics.length || parsed.blocks.length !== 2 || figure?.type !== 'figure' ||
      figure.id !== input.id || figure.src !== input.src || figure.alt !== input.alt || (figure.caption ?? undefined) !== (input.caption || undefined))
    throw new NaruError('NARU_ARGUMENT', 'Figure input crosses annotation boundaries.');
  return line;
}
export function figureMetadataEdits(doc: DocumentSnapshot, op: Extract<Operation, { type: 'setFigureMetadata' }>): TextEdit[] {
  const node = getById(doc, op.id);
  if (node.type !== 'figure') throw new NaruError('NARU_TARGET', 'Expected a figure ID.');
  if (op.src === undefined && op.alt === undefined && op.caption === undefined) throw new NaruError('NARU_ARGUMENT', 'Provide src, alt or caption.');
  const source = doc.source;
  // The parser admits any valid JSON string spelling (e.g. escaped slashes or \uXXXX);
  // compare parsed semantics, not the raw bytes. Equal values stay exact no-ops.
  const quoted = (range: { start: number; end: number }, value: string, label: string): void => {
    let parsed: unknown;
    try { parsed = JSON.parse(source.slice(range.start, range.end)); } catch { /* diagnosed below */ }
    if (parsed !== value) throw new NaruError('NARU_PATCH', `Missing or inconsistent ${label} source range; reparse the source.`);
  };
  const edits: TextEdit[] = [];
  if (op.src !== undefined && op.src !== node.src) {
    const problem = assetPathProblem(op.src);
    if (problem) throw new NaruError('NARU_ARGUMENT', problem);
    quoted(node.srcRange, node.src, 'src');
    edits.push(...minimalEdit(source, node.srcRange.start, node.srcRange.end, JSON.stringify(op.src)));
  }
  if (op.alt !== undefined && op.alt !== node.alt) {
    altText(op.alt);
    quoted(node.altRange, node.alt, 'alt');
    edits.push(...minimalEdit(source, node.altRange.start, node.altRange.end, JSON.stringify(op.alt)));
  }
  if (op.caption !== undefined) {
    captionValue(op.caption);
    if (op.caption === '' && node.captionAttributeRange) edits.push(...minimalEdit(source, node.captionAttributeRange.start, node.captionAttributeRange.end, ''));
    else if (op.caption === '' || op.caption === node.caption) { /* removing an absent caption or keeping the value is a no-op */ }
    else if (node.captionRange) { quoted(node.captionRange, node.caption!, 'caption'); edits.push(...minimalEdit(source, node.captionRange.start, node.captionRange.end, JSON.stringify(op.caption))); }
    else edits.push({ start: node.range.end, end: node.range.end, expected: '', text: ` caption=${JSON.stringify(op.caption)}` });
  }
  return edits;
}
