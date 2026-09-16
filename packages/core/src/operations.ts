import { ID_PATTERN, NaruError, validKey, wellFormed, type DocumentSnapshot, type EditPlan, type Operation, type TextEdit } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';
import { getById, getSection } from './query.js';
import { assertValid } from './validation.js';
import { applyTextEdits, minimalEdit } from './patch.js';

function scalar(value: string, label: string, empty = false): void {
  if (typeof value !== 'string' || !wellFormed(value) || /[\x00-\x1f\x7f]/.test(value) || value !== value.trim() || (!empty && !value)) throw new NaruError('NARU_ARGUMENT', `${label} must be a trimmed single-line string.`);
}
function title(value: string): void {
  scalar(value, 'Title');
  if (value.includes('{#') || /\s#+$/.test(value)) throw new NaruError('NARU_ARGUMENT', 'Title must not introduce an ID or closing heading marker.');
}
function id(value: string): void {
  if (!ID_PATTERN.test(value)) throw new NaruError('NARU_ARGUMENT', `Invalid ID: ${value}`);
}
function separator(left: string, right: string, eol: string): string {
  if (!left || !right) return '';
  const a = /(?:\r\n|\r|\n)*$/.exec(left)?.[0] ?? '';
  const b = /^(?:\r\n|\r|\n)*/.exec(right)?.[0] ?? '';
  const count = (a + b).match(/\r\n|\r|\n/g)?.length ?? 0;
  return eol.repeat(Math.max(0, 1 - count));
}
export function createDocument(documentTitle = 'Untitled', documentId = 'document'): DocumentSnapshot {
  title(documentTitle); id(documentId);
  const doc = parseDocument(`# ${documentTitle} {#${documentId}}\n`);
  assertValid(doc); return doc;
}
export function planOperation(doc: DocumentSnapshot, operation: Operation): EditPlan {
  assertValid(doc);
  const source = doc.source;
  let edits: TextEdit[];
  switch (operation.type) {
    case 'setHeadingTitle': {
      title(operation.title);
      const heading = getSection(doc, operation.id).heading;
      edits = minimalEdit(source, heading.titleRange.start, heading.titleRange.end, operation.title); break;
    }
    case 'insertSection': {
      title(operation.title); id(operation.id);
      const target = getSection(doc, operation.after), point = target.end;
      const text = `${'#'.repeat(target.heading.level)} ${operation.title} {#${operation.id}}${doc.eol}${doc.eol}`;
      edits = [{ start: point, end: point, expected: '', text: separator(source.slice(0, point), text, doc.eol) + text }]; break;
    }
    case 'removeSection': {
      const target = getSection(doc, operation.id);
      edits = [{ start: target.start, end: target.end, expected: source.slice(target.start, target.end), text: '' }]; break;
    }
    case 'moveSection': {
      const target = getSection(doc, operation.id), after = getSection(doc, operation.after);
      if (target.parentStart !== after.parentStart || target.heading.level !== after.heading.level) throw new NaruError('NARU_ARGUMENT', 'Only sibling sections of equal level can be moved.');
      if (target.start === after.start || target.start === after.end) { edits = []; break; }
      if (after.start >= target.start && after.start < target.end) throw new NaruError('NARU_ARGUMENT', 'Cannot move a section inside itself.');
      const chunk = source.slice(target.start, target.end), point = after.end;
      const text = separator(source.slice(0, point), chunk, doc.eol) + chunk + separator(chunk, source.slice(point), doc.eol);
      edits = [{ start: target.start, end: target.end, expected: chunk, text: '' }, { start: point, end: point, expected: '', text }]; break;
    }
    case 'replaceParagraph': {
      const section = getSection(doc, operation.id);
      const startIndex = doc.blocks.indexOf(section.heading);
      const direct = [];
      for (const block of doc.blocks.slice(startIndex + 1)) {
        if (block.type === 'heading') break;
        if (block.type === 'paragraph') direct.push(block);
      }
      if (!Number.isInteger(operation.index) || operation.index < 0 || !direct[operation.index]) throw new NaruError('NARU_TARGET', 'Paragraph index is out of range.');
      const replacement = operation.text.replace(/\r\n|\r|\n/g, doc.eol);
      const parsed = parseDocument(replacement), block = parsed.blocks[0];
      if (parsed.diagnostics.some(d => d.severity === 'error')) throw new NaruError('NARU_ARGUMENT', 'Invalid paragraph syntax.', parsed.diagnostics);
      if (parsed.blocks.length !== 1 || block?.type !== 'paragraph' || block.range.start !== 0 || block.range.end !== replacement.length) throw new NaruError('NARU_ARGUMENT', 'Replacement must be exactly one paragraph without surrounding blank lines.');
      const target = direct[operation.index]!;
      edits = minimalEdit(source, target.range.start, target.range.end, replacement); break;
    }
    case 'setDirectiveAttribute': {
      const node = getById(doc, operation.id);
      if (node.type !== 'directive') throw new NaruError('NARU_TARGET', 'Target is not a directive.');
      if (!validKey(operation.key) || operation.key === 'id') throw new NaruError('NARU_ARGUMENT', 'Invalid attribute key; ID changes need a reference-aware operation.');
      scalar(operation.value, 'Attribute value', true);
      const attr = node.attributes.find(a => a.key === operation.key);
      edits = attr ? minimalEdit(source, attr.valueRange.start, attr.valueRange.end, operation.value) : [{ start: node.headerEnd, end: node.headerEnd, expected: '', text: `${operation.key}: ${operation.value}${doc.eol}` }]; break;
    }
    default: throw new NaruError('NARU_ARGUMENT', 'Unknown operation.');
  }
  const next = parseDocument(applyTextEdits(source, edits));
  assertValid(next);
  return { baseSource: source, edits, next };
}
