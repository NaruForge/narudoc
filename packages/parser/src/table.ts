import type { TableRow } from '@naruforge/narudoc-model';
import { parseInline } from './inline.js';

/** Bounded pipe dialect: outer pipes required; escapes and single-backtick code share inline rules. */
export function parseTableRow(text: string, offset: number): TableRow | undefined {
  const begin = text.search(/\S/), end = text.trimEnd().length - 1;
  if (begin < 0 || text[begin] !== '|' || text[end] !== '|' || end <= begin) return undefined;
  const pipes = [begin];
  for (let i = begin + 1; i <= end; i++) {
    if (text[i] === '\\' && /[\\`*\[\]()|]/.test(text[i + 1] ?? '')) { i++; continue; }
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1 && close < end) { i = close; continue; }
    }
    if (text[i] === '|') pipes.push(i);
  }
  if (pipes.at(-1) !== end) return undefined;
  const cells = pipes.slice(0, -1).map((pipe, index) => {
    const stop = pipes[index + 1]!;
    const raw = text.slice(pipe + 1, stop);
    const left = /^[ \t]*/.exec(raw)![0].length;
    const content = raw.slice(left).replace(/[ \t]+$/, '');
    const start = offset + pipe + 1 + left;
    return { range: { start: offset + pipe + 1, end: offset + stop }, contentRange: { start, end: start + content.length }, inline: parseInline(content, 0, start, true) };
  });
  return { range: { start: offset, end: offset + text.length }, cells };
}
