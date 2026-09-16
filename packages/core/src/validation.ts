import { NaruError, type Diagnostic, type DocumentSnapshot } from '@naruforge/narudoc-model';
import { internalReferences } from './references.js';
export function validateDocument(doc: DocumentSnapshot): Diagnostic[] {
  const out = [...doc.diagnostics], ids = new Set<string>();
  for (const block of doc.blocks) {
    if ('id' in block && block.id !== undefined) {
      if (ids.has(block.id)) out.push({ code: 'NARU_DUPLICATE_ID', message: `Duplicate ID: ${block.id}`, severity: 'error', range: block.range });
      ids.add(block.id);
    }
  }
  for (const { block, link, id } of internalReferences(doc)) {
    if (!ids.has(id)) out.push({ code: 'NARU_REFERENCE', message: `Broken internal reference: ${link.url}`, severity: 'error', range: block.range });
  }
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
