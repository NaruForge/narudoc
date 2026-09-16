import type { Inline } from '@naruforge/narudoc-model';

/** Deliberately small inline dialect; unknown markup remains literal text. */
export function parseInline(source: string, depth = 0, sourceOffset?: number, table = false): Inline[] {
  if (depth > 16) return [{ type: 'text', value: source }];
  const out: Inline[] = [];
  const located = (node: Inline, start: number, end: number): Inline => sourceOffset === undefined ? node : { ...node, range: { start: sourceOffset + start, end: sourceOffset + end } };
  let text = '';
  let textStart = 0, textEnd = 0;
  const append = (value: string, start: number, end: number) => { if (!text) textStart = start; text += value; textEnd = end; };
  let labelEnd = -1, linkEnd = -1;
  const flush = () => { if (text) { out.push({ type: 'text', value: text, ...(sourceOffset === undefined ? {} : { range: { start: sourceOffset + textStart, end: sourceOffset + textEnd } }) }); text = ''; } };
  for (let i = 0; i < source.length;) {
    const ch = source[i]!;
    if (ch === '\\' && (/[\\`*\[\]()]/.test(source[i + 1] ?? '') || (table && source[i + 1] === '|'))) {
      append(source[i + 1]!, i, i + 2); i += 2; continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push(located({ type: 'code', value: source.slice(i + 1, end) }, i, end + 1)); i = end + 1; continue; }
    }
    if (ch === '*') {
      const marker = source.startsWith('**', i) ? '**' : '*';
      const end = source.indexOf(marker, i + marker.length);
      if (end > i + marker.length) {
        flush(); out.push(located({ type: marker === '**' ? 'strong' : 'emphasis', children: parseInline(source.slice(i + marker.length, end), depth + 1, sourceOffset === undefined ? undefined : sourceOffset + i + marker.length, table) }, i, end + marker.length));
        i = end + marker.length; continue;
      }
    }
    if (ch === '[') {
      // Opening brackets before the same label terminator share one scan,
      // including when the URL is malformed or no terminator exists.
      if (labelEnd <= i) {
        labelEnd = i + 1;
        while (labelEnd < source.length && !/[\]\r\n]/.test(source[labelEnd]!)) labelEnd++;
        linkEnd = -1;
        if (source[labelEnd] === ']' && source[labelEnd + 1] === '(') {
          let end = labelEnd + 2;
          while (end < source.length && !/[\s()]/.test(source[end]!)) end++;
          if (end > labelEnd + 2 && source[end] === ')') linkEnd = end;
        }
      }
      if (labelEnd > i + 1 && linkEnd !== -1) {
        const label = source.slice(i + 1, labelEnd);
        const value = table ? label.replace(/(\\+)\|/g, (_, slashes: string) => (slashes.length % 2 ? slashes.slice(1) : slashes) + '|') : label;
        flush(); out.push(located({ type: 'link', url: source.slice(labelEnd + 2, linkEnd), children: [{ type: 'text', value }],
          ...(sourceOffset === undefined ? {} : { urlRange: { start: sourceOffset + labelEnd + 2, end: sourceOffset + linkEnd } }) }, i, linkEnd + 1));
        i = linkEnd + 1; continue;
      }
    }
    append(ch, i, i + 1); i++;
  }
  flush(); return out;
}
