import type { Block, DocumentSnapshot, Inline } from '@naruforge/narudoc-model';

function groups(block: Block): Inline[][] {
  switch (block.type) {
    case 'heading': case 'paragraph': return [block.inline];
    case 'list': return block.items;
    case 'directive': return [block.body];
    default: return [];
  }
}
/** Shares the exact semantic link traversal between validation and editing. */
export function* internalReferences(doc: DocumentSnapshot): Generator<{
  block: Block; link: Extract<Inline, { type: 'link' }>; id: string;
}> {
  function* visit(nodes: Inline[]): Generator<Extract<Inline, { type: 'link' }>> {
    for (const node of nodes) {
      if (node.type === 'link' && node.url.startsWith('#')) yield node;
      if ('children' in node) yield* visit(node.children);
    }
  }
  for (const block of doc.blocks) for (const group of groups(block)) for (const link of visit(group)) {
    let id = '';
    try { id = decodeURIComponent(link.url.slice(1)); } catch { /* Validation rejects malformed fragments. */ }
    yield { block, link, id };
  }
}
