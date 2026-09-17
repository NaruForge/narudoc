import { ID_PATTERN, wellFormed, type Diagnostic, type Figure } from '@naruforge/narudoc-model';

export const figureStart = (text: string): boolean => /^@figure(?:\s|$)/.test(text);
/** Parses one standalone @figure line; on failure records a diagnostic and returns undefined. */
export function parseFigure(text: string, offset: number, diagnostics: Diagnostic[]): Omit<Figure, 'type' | 'range'> | undefined {
  const range = { start: offset, end: offset + text.length };
  const fail = () => diagnostics.push({ code: 'NARU_FIGURE', message: 'Expected @figure with JSON-quoted id, src, alt and optional caption.', severity: 'error', range });
  let at = 7, failed = false;
  const seen = new Set<string>();
  const result: Partial<Omit<Figure, 'type' | 'range'>> = {};
  while (at < text.length && !failed) {
    if (/^[ \t]*$/.test(text.slice(at))) break;
    const match = /^[ \t]+([A-Za-z][A-Za-z0-9_-]*)=("(?:[^"\\\r\n]|\\[^\r\n])*")/.exec(text.slice(at));
    if (!match) { fail(); failed = true; break; }
    const key = match[1]!, raw = match[2]!, valueStart = offset + at + match[0].length - raw.length;
    let value: string | undefined;
    try { value = JSON.parse(raw); } catch { /* diagnosed below */ }
    if (value === undefined || seen.has(key) || !['id', 'src', 'alt', 'caption'].includes(key) || !wellFormed(value) || /[\x00-\x1f\x7f]/.test(value)) { fail(); failed = true; break; }
    seen.add(key);
    if (key === 'id') {
      if (!ID_PATTERN.test(value)) { fail(); failed = true; break; }
      result.id = value; result.idRange = { start: valueStart + 1, end: valueStart + raw.length - 1 };
    } else if (key === 'src') {
      if (!value) { fail(); failed = true; break; }
      result.src = value; result.srcRange = { start: valueStart, end: valueStart + raw.length };
    } else if (key === 'alt') {
      result.alt = value; result.altRange = { start: valueStart, end: valueStart + raw.length };
    } else {
      result.caption = value; result.captionRange = { start: valueStart, end: valueStart + raw.length };
      result.captionAttributeRange = { start: offset + at, end: offset + at + match[0].length };
    }
    at += match[0].length;
  }
  if (failed || !seen.has('id') || !seen.has('src') || !seen.has('alt')) { if (!failed) fail(); return undefined; }
  return result as Omit<Figure, 'type' | 'range'>;
}
