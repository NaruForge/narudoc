import type { Inline } from '@naruforge/narudoc-model';

/** Deliberately small inline dialect; unknown markup remains literal text. */
export function parseInline(source: string, depth = 0, sourceOffset?: number): Inline[] {
  if (depth > 16) return [{ type: 'text', value: source }];
  const out: Inline[] = [];
  let text = '';
  let labelEnd = -1, linkEnd = -1;
  const flush = () => { if (text) { out.push({ type: 'text', value: text }); text = ''; } };
  for (let i = 0; i < source.length;) {
    const ch = source[i]!;
    if (ch === '\\' && /[\\`*\[\]()]/.test(source[i + 1] ?? '')) {
      text += source[i + 1]; i += 2; continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ type: 'code', value: source.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === '*') {
      const marker = source.startsWith('**', i) ? '**' : '*';
      const end = source.indexOf(marker, i + marker.length);
      if (end > i + marker.length) {
        flush(); out.push({ type: marker === '**' ? 'strong' : 'emphasis', children: parseInline(source.slice(i + marker.length, end), depth + 1, sourceOffset === undefined ? undefined : sourceOffset + i + marker.length) });
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
        flush(); out.push({ type: 'link', url: source.slice(labelEnd + 2, linkEnd), children: [{ type: 'text', value: source.slice(i + 1, labelEnd) }],
          ...(sourceOffset === undefined ? {} : { urlRange: { start: sourceOffset + labelEnd + 2, end: sourceOffset + linkEnd } }) });
        i = linkEnd + 1; continue;
      }
    }
    text += ch; i++;
  }
  flush(); return out;
}
