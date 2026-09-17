import { ID_PATTERN, wellFormed, type Diagnostic, type Table } from '@naruforge/narudoc-model';

export const annotationStart = (text: string): boolean => /^@table(?:\s|$)/.test(text);
export function parseAnnotation(text: string, offset: number, diagnostics: Diagnostic[]): Partial<Table> {
  const result: Partial<Table> = { annotationRange: { start: offset, end: offset + text.length } };
  const fail = () => diagnostics.push({ code: 'NARU_TABLE_ANNOTATION', message: 'Expected @table with one id and optional single-line caption, followed by a pipe table.', severity: 'error', range: result.annotationRange! });
  let at = 6; const seen = new Set<string>();
  while (at < text.length) {
    if (/^[ \t]*$/.test(text.slice(at))) break;
    const match = /^[ \t]+([A-Za-z][A-Za-z0-9_-]*)=("(?:[^"\\\r\n]|\\[^\r\n])*")/.exec(text.slice(at));
    if (!match) { fail(); break; }
    const key = match[1]!, raw = match[2]!, valueStart = offset + at + match[0].length - raw.length;
    let value: string;
    try { value = JSON.parse(raw); } catch { fail(); break; }
    if (seen.has(key) || !['id', 'caption'].includes(key) || !wellFormed(value) || /[\x00-\x1f\x7f]/.test(value)) { fail(); break; }
    seen.add(key);
    if (key === 'id') {
      if (!ID_PATTERN.test(value)) fail();
      result.id = value; result.idRange = { start: valueStart + 1, end: valueStart + raw.length - 1 };
    } else {
      result.caption = value; result.captionRange = { start: valueStart, end: valueStart + raw.length };
      result.captionAttributeRange = { start: offset + at, end: offset + at + match[0].length };
    }
    at += match[0].length;
  }
  if (!seen.has('id')) fail();
  return result;
}
