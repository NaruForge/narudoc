import { ID_PATTERN, NaruError, validKey, wellFormed, type DocumentSnapshot, type EditPlan, type Operation, type TextEdit } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';
import { getById, getSection, getTable } from './query.js';
import { readTableInput, tableCellText, tableSource } from './table-input.js';
import { assertValid } from './validation.js';
import { applyTextEdits, minimalEdit } from './patch.js';
import { internalReferences } from './references.js';
import { directiveSource, readInsertDirective } from './directive-input.js';

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
/** Retain the existing whitespace gap, adding only enough line breaks for a blank line. */
function paragraphPadding(gap: string, eol: string, beforeGap: boolean): string {
  let padding = '';
  // Count after concatenation: a bare CR adjacent to an LF becomes one CRLF.
  while (((beforeGap ? padding + gap : gap + padding).match(/\r\n|\r|\n/g)?.length ?? 0) < 2) padding += eol;
  return padding;
}
export function planOperation(doc: DocumentSnapshot, operation: Operation): EditPlan {
  assertValid(doc);
  const source = doc.source;
  let edits: TextEdit[];
  switch (operation.type) {
    case 'insertTable': {
      const input = readTableInput({ headers: operation.headers, rows: operation.rows });
      const section = getSection(doc, operation.sectionId);
      let end = doc.blocks.indexOf(section.heading) + 1;
      while (end < doc.blocks.length && doc.blocks[end]!.type !== 'heading') end++;
      const point = doc.blocks[end - 1]!.range.end, next = doc.blocks[end];
      const right = next ? paragraphPadding(source.slice(point, next.range.start), doc.eol, true) : '';
      edits = [{ start: point, end: point, expected: '', text: doc.eol.repeat(2) + tableSource(input, doc.eol) + right }]; break;
    }
    case 'setTableCell': {
      const text = tableCellText(operation.text);
      const table = getTable(doc, operation.sectionId, operation.tableIndex);
      if (!['header', 'body'].includes(operation.part) || !Number.isSafeInteger(operation.row) || operation.row < 0 || (operation.part === 'header' && operation.row !== 0)) throw new NaruError('NARU_ARGUMENT', 'Invalid table part/row; header row must be zero.');
      const row = operation.part === 'header' ? table.header : table.rows[operation.row];
      if (!row || !Number.isSafeInteger(operation.column) || operation.column < 0 || !row.cells[operation.column]) throw new NaruError('NARU_TARGET', 'Cell coordinates are out of range.');
      const range = row.cells[operation.column]!.contentRange;
      edits = minimalEdit(source, range.start, range.end, text); break;
    }
    case 'insertDirective': {
      const input = readInsertDirective(operation);
      const section = getSection(doc, input.sectionId);
      if (doc.blocks.some(block => 'id' in block && block.id === input.id)) throw new NaruError('NARU_ARGUMENT', `ID already exists: ${input.id}`);
      let end = doc.blocks.indexOf(section.heading) + 1;
      while (end < doc.blocks.length && doc.blocks[end]!.type !== 'heading') end++;
      const point = doc.blocks[end - 1]!.range.end, next = doc.blocks[end];
      const right = next ? paragraphPadding(source.slice(point, next.range.start), doc.eol, true) : '';
      edits = [{ start: point, end: point, expected: '', text: doc.eol.repeat(2) + directiveSource(input, doc.eol) + right }]; break;
    }
    case 'renameId': {
      scalar(operation.newId, 'New ID');
      id(operation.newId);
      const node = getById(doc, operation.id);
      if (operation.newId === operation.id) { edits = []; break; }
      if (doc.blocks.some(block => 'id' in block && block.id === operation.newId)) throw new NaruError('NARU_ARGUMENT', `ID already exists: ${operation.newId}`);
      const range = node.type === 'heading' ? node.idRange : node.type === 'directive' ? node.attributes.find(attr => attr.key === 'id')?.valueRange : undefined;
      if (!range || source.slice(range.start, range.end) !== operation.id) throw new NaruError('NARU_PATCH', 'Missing or inconsistent ID source range; reparse the source.');
      edits = minimalEdit(source, range.start, range.end, operation.newId);
      for (const reference of internalReferences(doc)) {
        if (reference.id !== operation.id) continue;
        const urlRange = reference.link.urlRange;
        if (!urlRange || source.slice(urlRange.start, urlRange.end) !== reference.link.url) throw new NaruError('NARU_PATCH', 'Missing or inconsistent link source range; reparse the source.');
        edits.push(...minimalEdit(source, urlRange.start, urlRange.end, `#${operation.newId}`));
      }
      break;
    }
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
    case 'insertChildSection': {
      title(operation.title); scalar(operation.id, 'New ID'); id(operation.id);
      const parent = getSection(doc, operation.parent);
      if (parent.heading.level === 6) throw new NaruError('NARU_ARGUMENT', 'A level 6 section cannot have a child section.');
      if (doc.blocks.some(block => 'id' in block && block.id === operation.id)) throw new NaruError('NARU_ARGUMENT', `ID already exists: ${operation.id}`);
      // Include every descendant, not just the parent's direct body.
      let end = doc.blocks.indexOf(parent.heading) + 1;
      while (end < doc.blocks.length && doc.blocks[end]!.range.start < parent.end) end++;
      const point = doc.blocks[end - 1]!.range.end, next = doc.blocks[end];
      const heading = `${'#'.repeat(parent.heading.level + 1)} ${operation.title} {#${operation.id}}`;
      const right = next ? paragraphPadding(source.slice(point, next.range.start), doc.eol, true) : '';
      edits = [{ start: point, end: point, expected: '', text: doc.eol.repeat(2) + heading + right }]; break;
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
    case 'insertParagraph': {
      const section = getSection(doc, operation.id);
      const start = doc.blocks.indexOf(section.heading) + 1;
      let end = start;
      while (end < doc.blocks.length && doc.blocks[end]!.type !== 'heading') end++;
      const paragraphs = doc.blocks.slice(start, end).filter(block => block.type === 'paragraph');
      if (!Number.isSafeInteger(operation.index) || operation.index < 0 || operation.index > paragraphs.length) throw new NaruError('NARU_TARGET', 'Paragraph insertion index is out of range.');
      if (typeof operation.text !== 'string' || !wellFormed(operation.text)) throw new NaruError('NARU_ARGUMENT', 'Text must be a well-formed Unicode string.');
      const paragraph = operation.text.replace(/\r\n|\r|\n/g, doc.eol);
      const standalone = parseDocument(paragraph), standaloneBlock = standalone.blocks[0];
      if (standalone.diagnostics.length || standalone.blocks.length !== 1 || standaloneBlock?.type !== 'paragraph' || standaloneBlock.range.start !== 0 || standaloneBlock.range.end !== paragraph.length) throw new NaruError('NARU_ARGUMENT', 'Text must be exactly one paragraph.');
      const prefix = '# Validation {#validation}\n\n';
      const parsed = parseDocument(prefix + paragraph), block = parsed.blocks[1];
      if (parsed.diagnostics.some(d => d.severity === 'error') || parsed.blocks.length !== 2 ||
          block?.type !== 'paragraph' || block.range.start !== prefix.length || block.range.end !== prefix.length + paragraph.length) {
        throw new NaruError('NARU_ARGUMENT', 'Text must be exactly one paragraph without surrounding blank lines.');
      }
      const target = paragraphs[operation.index];
      const nextIndex = target ? doc.blocks.indexOf(target) : end;
      const previous = doc.blocks[nextIndex - 1]!;
      const next = doc.blocks[nextIndex];
      const point = target ? target.range.start : previous.range.end;
      const left = paragraphPadding(source.slice(previous.range.end, point), doc.eol, false);
      const right = next ? paragraphPadding(source.slice(point, next.range.start), doc.eol, true) : '';
      edits = [{ start: point, end: point, expected: '', text: left + paragraph + right }]; break;
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
      const standalone = parseDocument(replacement), standaloneBlock = standalone.blocks[0];
      if (standalone.diagnostics.length || standalone.blocks.length !== 1 || standaloneBlock?.type !== 'paragraph' || standaloneBlock.range.start !== 0 || standaloneBlock.range.end !== replacement.length) throw new NaruError('NARU_ARGUMENT', 'Replacement must be exactly one paragraph.');
      const prefix = '# Validation {#validation}\n\n';
      const parsed = parseDocument(prefix + replacement), block = parsed.blocks[1];
      if (parsed.diagnostics.some(d => d.severity === 'error')) throw new NaruError('NARU_ARGUMENT', 'Invalid paragraph syntax.', parsed.diagnostics);
      if (parsed.blocks.length !== 2 || block?.type !== 'paragraph' || block.range.start !== prefix.length || block.range.end !== prefix.length + replacement.length) throw new NaruError('NARU_ARGUMENT', 'Replacement must be exactly one paragraph without surrounding blank lines.');
      const target = direct[operation.index]!;
      edits = minimalEdit(source, target.range.start, target.range.end, replacement); break;
    }
    case 'replaceDirectiveParagraph': {
      const node = getById(doc, operation.id);
      if (node.type !== 'directive') throw new NaruError('NARU_TARGET', 'Target is not a directive.');
      const paragraphs = node.children.filter(child => child.type === 'paragraph');
      if (!Number.isSafeInteger(operation.index) || operation.index < 0 || !paragraphs[operation.index]) throw new NaruError('NARU_TARGET', 'Directive paragraph index is out of range.');
      if (typeof operation.text !== 'string' || !wellFormed(operation.text)) throw new NaruError('NARU_ARGUMENT', 'Replacement must be a well-formed Unicode string.');
      const target = paragraphs[operation.index]!;
      // An exact no-op must also retain mixed line endings within this paragraph.
      if (operation.text === source.slice(target.range.start, target.range.end)) { edits = []; break; }
      const replacement = operation.text.replace(/\r\n|\r|\n/g, doc.eol);
      // Parse in directive context: headings/metadata are literal here, while
      // delimiters, lists and fences must not turn a paragraph edit into structure edits.
      const prefix = `:::validation${doc.eol}${doc.eol}`;
      const parsed = parseDocument(`${prefix}${replacement}${doc.eol}:::`);
      const wrapper = parsed.blocks[0];
      const child = wrapper?.type === 'directive' ? wrapper.children[0] : undefined;
      if (parsed.diagnostics.some(d => d.severity === 'error') || parsed.blocks.length !== 1 ||
          wrapper?.type !== 'directive' || wrapper.children.length !== 1 || child?.type !== 'paragraph' ||
          child.range.start !== prefix.length || child.range.end !== prefix.length + replacement.length) {
        throw new NaruError('NARU_ARGUMENT', 'Replacement must be exactly one directive paragraph without surrounding blank lines.');
      }
      edits = minimalEdit(source, target.range.start, target.range.end, replacement); break;
    }
    case 'setDirectiveAttribute': {
      const node = getById(doc, operation.id);
      if (node.type !== 'directive') throw new NaruError('NARU_TARGET', 'Target is not a directive.');
      if (!validKey(operation.key) || operation.key === 'id') throw new NaruError('NARU_ARGUMENT', 'Invalid attribute key; use renameId for ID changes.');
      scalar(operation.value, 'Attribute value', true);
      const attr = node.attributes.find(a => a.key === operation.key);
      edits = attr ? minimalEdit(source, attr.valueRange.start, attr.valueRange.end, operation.value) : [{ start: node.headerEnd, end: node.headerEnd, expected: '', text: `${operation.key}: ${operation.value}${doc.eol}` }]; break;
    }
    default: throw new NaruError('NARU_ARGUMENT', 'Unknown operation.');
  }
  const next = parseDocument(applyTextEdits(source, edits));
  assertValid(next);
  if (operation.type === 'setTableCell') {
    const before = getTable(doc, operation.sectionId, operation.tableIndex), after = getTable(next, operation.sectionId, operation.tableIndex);
    const rows = [before.header, ...before.rows], nextRows = [after.header, ...after.rows];
    if (rows.length !== nextRows.length || rows.some((row, i) => row.cells.length !== nextRows[i]!.cells.length || row.cells.some((cell, j) => {
      const expected = i === (operation.part === 'header' ? 0 : operation.row + 1) && j === operation.column ? operation.text : source.slice(cell.contentRange.start, cell.contentRange.end);
      const range = nextRows[i]!.cells[j]!.contentRange;
      return next.source.slice(range.start, range.end) !== expected;
    }))) throw new NaruError('NARU_ARGUMENT', 'Cell edit changes table boundaries.');
  }
  return { baseSource: source, edits, next };
}
