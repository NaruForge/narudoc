import { inlineText, type Block, type DocumentSnapshot, type Inline } from '@naruforge/narudoc-model';
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function safeUrl(value: string): boolean {
  if (!value || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//')) return false;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
  return !scheme || ['https', 'http', 'mailto'].includes(scheme[1]!.toLowerCase());
}
function renderInline(nodes: Inline[]): string {
  return nodes.map(n => {
    switch (n.type) {
      case 'text': return escapeHtml(n.value);
      case 'code': return `<code>${escapeHtml(n.value)}</code>`;
      case 'emphasis': return `<em>${renderInline(n.children)}</em>`;
      case 'strong': return `<strong>${renderInline(n.children)}</strong>`;
      case 'link': return safeUrl(n.url) ? `<a href="${escapeHtml(n.url)}" rel="noopener noreferrer">${renderInline(n.children)}</a>` : renderInline(n.children);
    }
  }).join('');
}
function renderBlock(block: Block): string {
  switch (block.type) {
    case 'metadata': return '';
    case 'heading': return `<h${block.level}${block.id === undefined ? '' : ` id="${escapeHtml(block.id)}"`}>${renderInline(block.inline)}</h${block.level}>`;
    case 'paragraph': return `<p>${renderInline(block.inline)}</p>`;
    case 'table': return `<table><thead><tr>${block.header.cells.map(c => `<th>${renderInline(c.inline)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.cells.map(c => `<td>${renderInline(c.inline)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'code': return `<pre><code>${escapeHtml(block.value)}</code></pre>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}${block.ordered ? ` start="${block.start}"` : ''}>${block.items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`;
    }
    case 'directive': return `<aside${block.id === undefined ? '' : ` id="${escapeHtml(block.id)}"`} data-kind="${escapeHtml(block.name)}"><strong>${escapeHtml(block.name)}</strong><dl>${block.attributes.filter(a => a.key !== 'id').map(a => `<dt>${escapeHtml(a.key)}</dt><dd>${escapeHtml(a.value)}</dd>`).join('')}</dl>${block.children.map(renderBlock).join('')}</aside>`;
  }
}
export { renderBlock as renderBlockHtml };
/** Pure projection. No filesystem, network, editor, or raw HTML execution. */
export function renderHtml(doc: DocumentSnapshot): string {
  const metadata = doc.blocks.find(b => b.type === 'metadata');
  const heading = doc.blocks.find(b => b.type === 'heading');
  const title = metadata?.attributes.find(a => a.key === 'title')?.value ?? (heading ? inlineText(heading.inline) : 'NaruDoc');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>body{max-width:56rem;margin:3rem auto;padding:0 1.5rem;font:18px/1.65 system-ui,sans-serif}pre{overflow:auto;padding:1rem;background:#f2f3f5}aside{border-left:3px solid #64748b;padding:1rem;margin:1rem 0}dt{font-weight:600}dd{margin-left:1rem}a{color:#1457a8}p{white-space:pre-wrap}</style></head><body><main>\n${doc.blocks.map(renderBlock).filter(Boolean).join('\n')}\n</main></body></html>\n`;
}
