import type { Inline } from '@naruforge/narudoc-model';

/** Deliberately small inline dialect; unknown markup remains literal text. */
export function parseInline(source: string, depth = 0): Inline[] {
  if (depth > 16) return [{ type: 'text', value: source }];
  const out: Inline[] = [];
  let text = '';
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
        flush(); out.push({ type: marker === '**' ? 'strong' : 'emphasis', children: parseInline(source.slice(i + marker.length, end), depth + 1) });
        i = end + marker.length; continue;
      }
    }
    if (ch === '[') {
      const match = /^\[([^\]\r\n]+)\]\(([^\s()]+)\)/.exec(source.slice(i));
      if (match) {
        flush(); out.push({ type: 'link', url: match[2]!, children: [{ type: 'text', value: match[1]! }] });
        i += match[0].length; continue;
      }
    }
    text += ch; i++;
  }
  flush(); return out;
}
