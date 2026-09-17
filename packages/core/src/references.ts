import { ID_PATTERN, type Block, type DocumentSnapshot, type Inline, type ReferenceContext, type ReferenceUse } from '@naruforge/narudoc-model';

function groups(block: Block): Inline[][] {
  switch (block.type) {
    case 'heading': case 'paragraph': return [block.inline];
    case 'list': return block.items;
    case 'table': return [block.header, ...block.rows].flatMap(row => row.cells.map(cell => cell.inline));
    default: return [];
  }
}
/** One snapshot owns numbering, definitions and both kinds of reference use. */
export function resolveReferences(doc: DocumentSnapshot): ReferenceContext {
  const byNode = new Map<Inline, ReferenceUse>(), byBlock = new Map<Block, import('@naruforge/narudoc-model').ReferenceDefinition>();
  const byId = new Map<string, import('@naruforge/narudoc-model').ReferenceDefinition[]>();
  const context: ReferenceContext = { snapshot: doc, definitions: [], references: [], diagnostics: [], byNode, byBlock };
  const seen = new Set<string>(); let number = 0;
  for (const block of doc.blocks) if ('id' in block && block.id !== undefined) {
    if (seen.has(block.id)) context.diagnostics.push({ code: 'NARU_DUPLICATE_ID', message: `Duplicate ID: ${block.id}`, severity: 'error', range: block.range });
    seen.add(block.id);
    context.definitions.push({ id: block.id, block, ...(block.type === 'table' ? { number: ++number, label: `Table ${number}` } : {}) });
    const definition = context.definitions.at(-1)!; byBlock.set(block, definition);
    byId.set(block.id, [...(byId.get(block.id) ?? []), definition]);
  }
  function visit(block: Block, nodes: Inline[]) {
    for (const node of nodes) {
      if (node.type === 'reference' || (node.type === 'link' && node.url.startsWith('#'))) {
        let id = node.type === 'reference' ? node.targetId : '';
        if (node.type === 'link') { try { id = decodeURIComponent(node.url.slice(1)); } catch { /* diagnosed below */ } }
        const matches = byId.get(id) ?? [], target = matches.length === 1 ? matches[0] : undefined;
        const syntaxError = node.type === 'reference' && (node.malformed || !ID_PATTERN.test(id));
        const wrongKind = node.type === 'reference' && target && target.block.type !== 'table';
        const use: ReferenceUse = { block, node, id, ...(!syntaxError && !wrongKind && target ? { target, ...(node.type === 'reference' ? { label: target.label } : {}) } : {}) };
        context.references.push(use);
        byNode.set(node, use);
        if (syntaxError || wrongKind || !target) context.diagnostics.push({ code: syntaxError ? 'NARU_REFERENCE_SYNTAX' : wrongKind ? 'NARU_REFERENCE_KIND' : 'NARU_REFERENCE', message: syntaxError ? 'Malformed semantic reference.' : wrongKind ? `Semantic reference requires a numbered table: ${id}` : `Broken or ambiguous internal reference: ${id}`, severity: 'error', range: node.type === 'link' ? block.range : node.range ?? block.range });
      }
      if ('children' in node) visit(block, node.children);
    }
  }
  for (const block of doc.blocks.flatMap<Block>(b => b.type === 'directive' ? b.children : [b])) for (const group of groups(block)) visit(block, group);
  return context;
}
export function referenceMetadata(doc: DocumentSnapshot) {
  const context = resolveReferences(doc);
  return {
    definitions: context.definitions.map(d => ({ id: d.id, kind: d.block.type, range: d.block.range, ...(d.block.type === 'table' ? { caption: d.block.caption ?? null, number: d.number, label: d.label } : {}) })),
    references: context.references.map(r => ({ kind: r.node.type, targetId: r.id, range: r.node.range, resolved: !!r.target, ...(r.label ? { label: r.label } : {}) })),
  };
}
/** Shares the exact semantic link traversal between validation and editing. */
export function* internalReferences(doc: DocumentSnapshot): Generator<{
  block: Block; link: Extract<Inline, { type: 'link' }>; id: string;
}> {
  for (const use of resolveReferences(doc).references) if (use.node.type === 'link') yield { block: use.block, link: use.node, id: use.id };
}
