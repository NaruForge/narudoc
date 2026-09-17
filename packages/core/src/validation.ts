import { NaruError, type Diagnostic, type DocumentSnapshot } from '@naruforge/narudoc-model';
import { resolveReferences } from './references.js';
export function validateDocument(doc: DocumentSnapshot): Diagnostic[] {
  const out = [...doc.diagnostics, ...resolveReferences(doc).diagnostics];
  let previousLevel = 0;
  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      if (block.level > previousLevel + 1) out.push({ code: 'NARU_HIERARCHY', message: 'Heading level skips a level.', severity: 'warning', range: block.range });
      previousLevel = block.level;
    }
  }
  return out.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
export function assertValid(doc: DocumentSnapshot): void {
  const diagnostics = validateDocument(doc);
  if (diagnostics.some(d => d.severity === 'error')) throw new NaruError('NARU_INVALID_DOCUMENT', 'Repair document diagnostics before semantic editing or rendering.', diagnostics);
}
