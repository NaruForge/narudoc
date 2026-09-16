import { NaruError } from '@naruforge/narudoc-model';

/** JSON.parse validates syntax; a lexical pass rejects duplicate (also escaped) object keys. */
export function parseJsonInput(source: string): unknown {
  const text = source.replace(/^\uFEFF/, '');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new NaruError('NARU_ARGUMENT', 'Input must be valid JSON.'); }
  const stack: Array<Set<string> | null> = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    const part = token[0];
    if (part === '{') stack.push(new Set());
    else if (part === '[') stack.push(null);
    else if (part === '}' || part === ']') stack.pop();
    else {
      let after = token.index + part.length;
      while (/[\t\r\n ]/.test(text[after] ?? '') && after < text.length) after++;
      if (text[after] !== ':') continue;
      const key = JSON.parse(part) as string, keys = stack.at(-1)!;
      if (keys.has(key)) throw new NaruError('NARU_ARGUMENT', `Duplicate JSON key: ${key}`);
      keys.add(key);
    }
  }
  return value;
}
