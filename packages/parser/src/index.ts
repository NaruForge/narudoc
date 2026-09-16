import { ID_PATTERN, validKey, wellFormed, type Attribute, type Block, type Diagnostic, type DocumentSnapshot, type Heading } from '@naruforge/narudoc-model';
import { parseInline } from './inline.js';
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
const special = (text: string) => headingPattern.test(text) || fencePattern.test(text) || listPattern.test(text) || text.startsWith(':::');

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
  let i = 0;
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
      blocks.push(node); i++; continue;
    }
    const fence = fencePattern.exec(line.text);
    if (fence) {
      const marker = fence[1]!;
      let j = i + 1;
      const close = new RegExp(`^${marker[0]}{${marker.length},}[ \\t]*$`);
      while (j < all.length && !close.test(all[j]!.text)) j++;
      if (j === all.length) error('NARU_FENCE', 'Unclosed code fence.', line.start, source.length);
      blocks.push({ type: 'code', language: fence[2]!.trim(), value: source.slice(line.next, all[j]?.start ?? source.length), range: { start: line.start, end: all[j]?.end ?? source.length } });
      i = j + 1; continue;
    }
    if (line.text.startsWith(':::')) {
      const opening = directivePattern.exec(line.text);
      if (!opening) { error('NARU_DIRECTIVE', 'Malformed or unexpected directive delimiter.', line.start, line.end); i++; continue; }
      let j = i + 1;
      while (j < all.length && !/^:::[ \t]*$/.test(all[j]!.text)) {
        if (all[j]!.text.startsWith(':::')) error('NARU_DIRECTIVE_NESTED', 'Nested directives are not supported.', all[j]!.start, all[j]!.end);
        j++;
      }
      if (j === all.length) error('NARU_DIRECTIVE', 'Unclosed directive.', line.start, source.length);
      let split = i + 1; while (split < j && all[split]!.text.trim()) split++;
      const attrs = attributes(all.slice(i + 1, split));
      const id = attrs.find(a => a.key === 'id')?.value;
      const bodyStart = all[split]?.next ?? source.length;
      const node: Block = { type: 'directive', name: opening[1]!, attributes: attrs, body: parseInline(source.slice(bodyStart, all[j]?.start ?? source.length), 0, bodyStart), headerEnd: all[split]?.start ?? source.length, range: { start: line.start, end: all[j]?.end ?? source.length } };
      if (id !== undefined) { node.id = id; if (!ID_PATTERN.test(id)) error('NARU_ID', `Invalid ID: ${id}`, line.start, line.end); }
      blocks.push(node); i = j + 1; continue;
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
      blocks.push({ type: 'list', ordered, start: ordered ? Number.parseInt(firstItem[1]!, 10) : 1, items, range: { start: line.start, end: all[j - 1]!.end } }); i = j; continue;
    }
    let j = i + 1;
    while (j < all.length && all[j]!.text.trim() && !special(all[j]!.text)) j++;
    const end = all[j - 1]!.end;
    blocks.push({ type: 'paragraph', inline: parseInline(source.slice(line.start, end), 0, line.start), range: { start: line.start, end } }); i = j;
  }
  return { source, blocks, diagnostics, eol };
}
