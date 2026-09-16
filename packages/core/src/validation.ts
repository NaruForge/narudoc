import { NaruError, type Block, type Diagnostic, type DocumentSnapshot, type Inline } from '@naruforge/narudoc-model';
function inlines(block: Block): Inline[][] {
  switch (block.type) {
    case 'heading': case 'paragraph': return [block.inline];
    case 'list': return block.items;
    case 'directive': return [block.body];
    default: return [];
  }
}
export function validateDocument(doc: DocumentSnapshot): Diagnostic[] {
  const out = [...doc.diagnostics], ids = new Set<string>();
  for (const block of doc.blocks) {
    if ('id' in block && block.id !== undefined) {
      if (ids.has(block.id)) out.push({ code: 'NARU_DUPLICATE_ID', message: `Duplicate ID: ${block.id}`, severity: 'error', range: block.range });
      ids.add(block.id);
    }
  }
  const visit = (nodes: Inline[], block: Block): void => {
    for (const node of nodes) {
      if (node.type === 'link' && node.url.startsWith('#')) {
        let id = '';
        try { id = decodeURIComponent(node.url.slice(1)); } catch { /* Invalid fragments are broken references. */ }
        if (!ids.has(id)) out.push({ code: 'NARU_REFERENCE', message: `Broken internal reference: ${node.url}`, severity: 'error', range: block.range });
      }
      if ('children' in node) visit(node.children, block);
    }
  };
  let previousLevel = 0;
  for (const block of doc.blocks) {
    for (const group of inlines(block)) visit(group, block);
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
