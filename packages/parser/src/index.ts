import { ID_PATTERN, validKey, wellFormed, type Attribute, type Block, type Diagnostic, type DirectiveBodyBlock, type DocumentSnapshot, type Heading } from '@naruforge/narudoc-model';
import { parseInline } from './inline.js';
import { parseTableRow } from './table.js';
import { annotationStart, parseAnnotation } from './annotation.js';
import { figureStart, parseFigure } from './figure.js';
export { parseInline } from './inline.js';

interface Line { start: number; end: number; next: number; text: string }
function lines(source: string): Line[] {
  const out: Line[] = [];
  let start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (start < source.length) {
    let end = start;
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end++;
    const next = end + (source.startsWith('\r\n', end) ? 2 : end < source.length ? 1 : 0);
    out.push({ start, end, next, text: source.slice(start, end) }); start = next;
  }
  return out;
}
const headingPattern = /^(#{1,6})[ \t]+/;
const fencePattern = /^(`{3,}|~{3,})([^\r\n]*)$/;
const listPattern = /^([-+*]|\d{1,9}[.)])[ \t]+(.*)$/;
const directivePattern = /^:::([A-Za-z][A-Za-z0-9_-]*)[ \t]*$/;
const special = (text: string) => headingPattern.test(text) || fencePattern.test(text) || listPattern.test(text) || text.startsWith(':::') || annotationStart(text) || figureStart(text);

export function parseDocument(source: string): DocumentSnapshot {
  const all = lines(source), blocks: Block[] = [], diagnostics: Diagnostic[] = [];
  const eol = (/\r\n|\n|\r/.exec(source)?.[0] ?? '\n') as DocumentSnapshot['eol'];
  const error = (code: string, message: string, start: number, end: number) => diagnostics.push({ code, message, severity: 'error', range: { start, end } });
  if (!wellFormed(source) || source.includes('\0')) error('NARU_ENCODING', 'Source must contain valid Unicode without NUL.', 0, source.length);
  const attributes = (group: Line[]): Attribute[] => {
    const out: Attribute[] = [], seen = new Set<string>();
    for (const line of group) {
      if (!line.text.trim()) continue;
      const m = /^([A-Za-z][A-Za-z0-9_-]*)([ \t]*:[ \t]*)(.*?)([ \t]*)$/.exec(line.text);
      if (!m || !validKey(m[1]!)) { error('NARU_ATTRIBUTE', 'Expected a simple key: value attribute.', line.start, line.end); continue; }
      const key = m[1]!, value = m[3]!, start = line.start + key.length + m[2]!.length;
      if (seen.has(key)) error('NARU_ATTRIBUTE_DUPLICATE', `Duplicate attribute: ${key}`, line.start, line.end);
      seen.add(key);
      out.push({ key, value, range: { start: line.start, end: line.end }, valueRange: { start, end: start + value.length } });
    }
    return out;
  };
  // Shared scanners retain absolute positions in the original line table.
  const tableStart = (i: number) => {
    const header = all[i] && parseTableRow(all[i]!.text, all[i]!.start);
    const separator = all[i + 1] && parseTableRow(all[i + 1]!.text, all[i + 1]!.start);
    return header && separator && separator.cells.every(c => /^-{3,}$/.test(source.slice(c.contentRange.start, c.contentRange.end))) ? { header, separator } : undefined;
  };
  const scanBodyBlock = (i: number, target: DirectiveBodyBlock[] | Block[], startsBlock: (text: string) => boolean, tables = false): number => {
    const line = all[i]!;
    const fence = fencePattern.exec(line.text);
    if (fence) {
      const marker = fence[1]!;
      let j = i + 1;
      const close = new RegExp(`^${marker[0]}{${marker.length},}[ \\t]*$`);
      while (j < all.length && !close.test(all[j]!.text)) j++;
      if (j === all.length) error('NARU_FENCE', 'Unclosed code fence.', line.start, source.length);
      target.push({ type: 'code', language: fence[2]!.trim(), value: source.slice(line.next, all[j]?.start ?? source.length), range: { start: line.start, end: all[j]?.end ?? source.length } });
      return j + 1;
    }
    const firstItem = listPattern.exec(line.text);
    if (firstItem) {
      const ordered = /^\d/.test(firstItem[1]!); const items = [];
      let j = i;
      while (j < all.length) {
        const m = listPattern.exec(all[j]!.text);
        if (!m || /^\d/.test(m[1]!) !== ordered) break;
        items.push(parseInline(m[2]!, 0, all[j]!.end - m[2]!.length)); j++;
      }
      target.push({ type: 'list', ordered, start: ordered ? Number.parseInt(firstItem[1]!, 10) : 1, items, range: { start: line.start, end: all[j - 1]!.end } }); return j;
    }
    let j = i + 1;
    while (j < all.length && all[j]!.text.trim() && !startsBlock(all[j]!.text) && !(tables && tableStart(j))) j++;
    const end = all[j - 1]!.end;
    target.push({ type: 'paragraph', inline: parseInline(source.slice(line.start, end), 0, line.start), range: { start: line.start, end } }); return j;
  };
  let i = 0, hasHeading = false;
  if (all[0]?.text === '---') {
    let j = 1; while (j < all.length && all[j]!.text !== '---') j++;
    if (j === all.length) { error('NARU_METADATA', 'Unclosed metadata block.', all[0].start, source.length); i = j; }
    else { blocks.push({ type: 'metadata', attributes: attributes(all.slice(1, j)), range: { start: all[0].start, end: all[j]!.end } }); i = j + 1; }
  }
  while (i < all.length) {
    const line = all[i]!;
    if (!line.text.trim()) { i++; continue; }
    const heading = headingPattern.exec(line.text);
    if (heading) {
      const prefix = heading[0].length;
      let end = line.text.length;
      while (/[ \t]/.test(line.text[end - 1] ?? '') && end > prefix) end--;
      const anchor = /[ \t]+\{#([^{}]*)\}$/.exec(line.text.slice(0, end));
      let id: string | undefined;
      if (anchor) { id = anchor[1]!; end = anchor.index; }
      const closing = /[ \t]+#+$/.exec(line.text.slice(0, end));
      if (closing) end = closing.index;
      while (end > prefix && /[ \t]/.test(line.text[end - 1]!)) end--;
      const title = line.text.slice(prefix, end);
      const node: Heading = { type: 'heading', level: heading[1]!.length, title, inline: parseInline(title, 0, line.start + prefix), titleRange: { start: line.start + prefix, end: line.start + Math.max(prefix, end) }, range: { start: line.start, end: line.end } };
      if (id !== undefined && anchor) {
        node.id = id;
        const start = line.start + anchor.index + anchor[0].indexOf('{#') + 2;
        node.idRange = { start, end: start + id.length };
      }
      if (!title) error('NARU_HEADING', 'Heading title must not be empty.', line.start, line.end);
      if (id !== undefined && !ID_PATTERN.test(id)) error('NARU_ID', `Invalid ID: ${id}`, line.start, line.end);
      blocks.push(node); hasHeading = true; i++; continue;
    }
    if (line.text.startsWith(':::')) {
      const opening = directivePattern.exec(line.text);
      if (!opening) { error('NARU_DIRECTIVE', 'Malformed or unexpected directive delimiter.', line.start, line.end); i++; continue; }
      let split = i + 1;
      while (split < all.length && all[split]!.text.trim() && !all[split]!.text.startsWith(':::')) split++;
      const attrs = attributes(all.slice(i + 1, split));
      const id = attrs.find(a => a.key === 'id')?.value;
      const children: DirectiveBodyBlock[] = [];
      let j = split;
      const bodySpecial = (text: string) => fencePattern.test(text) || listPattern.test(text) || text.startsWith(':::');
      while (j < all.length && !/^:::[ \t]*$/.test(all[j]!.text)) {
        const childLine = all[j]!;
        if (!childLine.text.trim()) { j++; continue; }
        if (childLine.text.startsWith(':::')) {
          error('NARU_DIRECTIVE_NESTED', 'Nested directives are not supported.', childLine.start, childLine.end);
          j++; continue;
        }
        j = scanBodyBlock(j, children, bodySpecial);
      }
      if (j >= all.length) error('NARU_DIRECTIVE', 'Unclosed directive.', line.start, source.length);
      const node: Block = { type: 'directive', name: opening[1]!, attributes: attrs, children, headerEnd: all[split]?.start ?? source.length, range: { start: line.start, end: all[j]?.end ?? source.length } };
      if (id !== undefined) { node.id = id; if (!ID_PATTERN.test(id)) error('NARU_ID', `Invalid ID: ${id}`, line.start, line.end); }
      blocks.push(node); i = j + 1; continue;
    }
    if (figureStart(line.text)) {
      const figure = parseFigure(line.text, line.start, diagnostics);
      if (!hasHeading) error('NARU_FIGURE', 'A figure annotation must appear inside a section.', line.start, line.end);
      else if (figure) blocks.push({ ...figure, type: 'figure', range: { start: line.start, end: line.end } });
      i++; continue;
    }
    let annotation: ReturnType<typeof parseAnnotation> = {};
    if (annotationStart(line.text)) {
      annotation = parseAnnotation(line.text, line.start, diagnostics);
      let next = i + 1;
      if (all[next] && !all[next]!.text.trim()) next++;
      if (!hasHeading || !tableStart(next)) {
        error('NARU_TABLE_ANNOTATION', 'Table annotation must precede a section pipe table with at most one blank line.', line.start, line.end);
        i++; continue;
      }
      i = next;
    }
    const table = hasHeading ? tableStart(i) : undefined;
    if (table) {
      const width = table.header.cells.length;
      if (table.separator.cells.length !== width) error('NARU_TABLE_COLUMNS', 'Table separator width differs from header.', all[i + 1]!.start, all[i + 1]!.end);
      const rows = [];
      let j = i + 2;
      while (j < all.length) {
        const row = parseTableRow(all[j]!.text, all[j]!.start);
        if (!row) break;
        if (row.cells.length !== width) error('NARU_TABLE_COLUMNS', 'Table row width differs from header.', row.range.start, row.range.end);
        rows.push(row); j++;
      }
      blocks.push({ ...annotation, type: 'table', header: table.header, separatorRange: table.separator.range, rows, range: { start: line.start, end: all[j - 1]!.end } });
      i = j; continue;
    }
    i = scanBodyBlock(i, blocks, special, hasHeading);
  }
  return { source, blocks, diagnostics, eol };
}
