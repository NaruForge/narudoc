import { Schema, type Node as PMNode, type Mark } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
export { undo, redo } from 'prosemirror-history';
import { inlineText, NaruError, type DocumentSnapshot, type Inline, type Operation, type TextTarget } from '@naruforge/narudoc-model';
import { resolveReferences, parseDocument, planOperation, textTarget, textTargets } from '@naruforge/narudoc-core';
import { SourceSession } from './session.js';
export { SourceSession } from './session.js';
import { renderBlockHtml } from '@naruforge/narudoc-renderer-html';
export { DocumentEditor, mountDocumentProjection } from './document-editor.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph' },
    paragraph: { content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { group: 'inline' },
    protected: { inline: true, group: 'inline', atom: true, selectable: false, attrs: { label: {}, kind: {} }, toDOM: node => ['span', { class: 'protected-inline', contenteditable: 'false', title: 'Protected ' + node.attrs.kind }, node.attrs.label] },
  },
  marks: { strong: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] }, emphasis: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }] } },
});
interface Mapping { path: string; from: number; to: number; value: string }
function projection(snapshot: DocumentSnapshot, target: TextTarget) {
  const context = resolveReferences(snapshot);
  const mappings: Mapping[] = [];
  const gaps: Mapping[] = [];
  let position = 1;
  function visit(nodes: Inline[], prefix = '', marks: Mark[] = []): PMNode[] {
    const result = nodes.flatMap((node, index): PMNode[] => {
      const path = prefix + index;
      gaps.push({ path, from: position, to: position, value: '' });
      if (node.type === 'strong' || node.type === 'emphasis') return visit(node.children, path + '.', [...marks, schema.marks[node.type]!.create()]);
      if (node.type === 'text' && node.range && snapshot.source.slice(node.range.start, node.range.end) === node.value && !/[\r\n]/.test(node.value)) {
        mappings.push({ path, from: position, to: position + node.value.length, value: node.value });
        position += node.value.length;
        return node.value ? [schema.text(node.value, marks)] : [];
      }
      position++;
      return [schema.nodes.protected!.create({ label: inlineText([node], context), kind: node.type }, null, marks)];
    });
    gaps.push({ path: prefix + nodes.length, from: position, to: position, value: '' });
    return result;
  }
  const content = visit(textTarget(snapshot, target).inline);
  return { doc: schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, content)), mappings: [...mappings, ...gaps] };
}

export class BlockEditor {
  view: EditorView;
  private baseline: ReturnType<typeof projection>;
  private generation: number;
  private epoch: number;
  private composing = false;
  private committing = false;
  private destroyed = false;
  readonly key: string;
  private unsubscribe: () => void;
  constructor(readonly session: SourceSession, readonly target: TextTarget, host: HTMLElement, readonly report: (message: string) => void) {
    this.key = JSON.stringify(target); this.generation = session.generation; this.epoch = session.epoch;
    this.baseline = projection(session.snapshot, target);
    this.view = new EditorView(host, {
      state: EditorState.create({ schema, doc: this.baseline.doc, plugins: [history()] }),
      attributes: { role: 'textbox', 'aria-label': `${target.kind} ${target.id} ${target.index}`, 'data-target': this.key },
      dispatchTransaction: tr => this.dispatch(tr),
      handleKeyDown: (view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); return (event.shiftKey ? redo : undo)(view.state, view.dispatch); }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); return redo(view.state, view.dispatch); }
        if (event.key === 'Enter') { this.report('Block split/merge is not supported.'); return true; }
        return false;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        event.preventDefault();
        if (/[\r\n]/.test(text)) { this.report('Multiline paste is not supported; draft unchanged.'); return true; }
        view.dispatch(view.state.tr.insertText(text)); return true;
      },
      handleDrop: () => { this.report('Drag/drop is not supported.'); return true; },
      handleDOMEvents: {
        compositionstart: () => { this.composing = true; this.session.drafts.set(this.key, this.view.state.doc.textContent); this.session.notify(); return false; },
        compositionend: () => { this.composing = false; setTimeout(() => { if (!this.destroyed) this.commit(); }, 0); return false; },
      },
    });
    const listener = () => {
      if (this.committing || this.composing || this.session.drafts.has(this.key)) return;
      if (this.epoch !== session.epoch) { this.report('Snapshot replaced; editor mapping is stale. Reload the projection explicitly.'); return; }
      try {
        const next = projection(session.snapshot, target);
        // Other blocks may move source ranges; only unchanged projections may rebind.
        if (next.doc.eq(this.view.state.doc)) { this.baseline = next; this.generation = session.generation; }
      } catch { this.report('Target changed; editor mapping is stale. Draft is preserved.'); }
    };
    session.listeners.add(listener); this.unsubscribe = () => session.listeners.delete(listener);
  }
  private dispatch(tr: Transaction) {
    if (!tr.before.eq(this.view.state.doc)) { this.report('Stale transaction rejected.'); return; }
    this.view.updateState(this.view.state.apply(tr));
    if (!tr.docChanged) { this.publishSelection(); return; }
    this.session.drafts.set(this.key, this.view.state.doc.textContent);
    if (!this.composing) this.commit(); else this.session.notify();
  }
  private publishSelection() {
    if (this.session.drafts.has(this.key)) return;
    const { anchor, head } = this.view.state.selection;
    const point = (position: number) => ({ target: this.target, offset: this.view.state.doc.textBetween(0, position, '', node => String(node.attrs.label ?? '')).length });
    try { this.session.select(point(anchor), point(head), this.generation, this.epoch); } catch { /* Projection selection is not a valid source selection. */ }
  }
  commit() {
    const draft = this.view.state.doc;
    if (draft.eq(this.baseline.doc)) { this.session.drafts.delete(this.key); this.report(''); this.session.notify(); return; }
    try {
      if (this.epoch !== this.session.epoch || this.generation !== this.session.generation) throw new NaruError('NARU_STALE', 'Stale snapshot/mapping; draft preserved. Reload explicitly to replace it.');
      const from = this.baseline.doc.content.findDiffStart(draft.content);
      const end = this.baseline.doc.content.findDiffEnd(draft.content);
      if (from === null || !end) throw new NaruError('NARU_ARGUMENT', 'Unsupported edit.');
      // findDiffEnd can overlap start for pure insertion/deletion.
      const overlap = Math.max(0, from - Math.min(end.a, end.b));
      const oldEnd = end.a + overlap, newEnd = end.b + overlap;
      const mappings = this.baseline.mappings.filter(m => from >= m.from && oldEnd <= m.to);
      if (!mappings.length) throw new NaruError('NARU_ARGUMENT', 'Protected inline or markup boundary edit is unsupported.');
      const inserted = draft.textBetween(from, newEnd, '\n', '\uFFFC');
      let accepted: { op: Operation; projected: ReturnType<typeof projection> } | undefined;
      let failure: unknown;
      for (const mapping of mappings) {
        try {
          const text = mapping.value.slice(0, from - mapping.from) + inserted + mapping.value.slice(oldEnd - mapping.from);
          const op: Operation = { type: 'setInlineText', ...this.target, path: mapping.path, expected: mapping.value, text };
          const candidate = planOperation(this.session.snapshot, op);
          const projected = projection(candidate.next, this.target);
          if (projected.doc.eq(draft)) { accepted = { op, projected }; break; }
        } catch (error) { failure = error; }
      }
      if (!accepted) throw failure ?? new NaruError('NARU_ARGUMENT', 'Only ordinary text edits inside one inline run are supported.');
      const { op, projected } = accepted;
      this.committing = true;
      this.session.apply(op, this.generation);
      this.baseline = projected; this.generation = this.session.generation;
      this.session.drafts.delete(this.key); this.publishSelection(); this.report('');
    } catch (error) { this.session.drafts.set(this.key, draft.textContent); this.report((error as Error).message); }
    finally { this.committing = false; this.session.notify(); }
  }
  destroy() { this.destroyed = true; this.unsubscribe(); this.view.destroy(); }
}

/** Display unsupported blocks with the safe renderer; never import/export DOM as source. */
export function mountDocument(host: HTMLElement, session: SourceSession, report: (message: string) => void): BlockEditor[] {
  host.replaceChildren(); const editors: BlockEditor[] = [];
  const targets = new Map(textTargets(session.snapshot).map(item => [item.block, item.target]));
  const readonly = (parent: HTMLElement, block: Parameters<typeof renderBlockHtml>[0]) => {
    const wrapper = document.createElement('div'); wrapper.className = 'readonly-block'; wrapper.title = 'Read only';
    if (block.type === 'metadata') { const pre = document.createElement('pre'); pre.textContent = session.source.slice(block.range.start, block.range.end); wrapper.append(pre); }
    else wrapper.innerHTML = renderBlockHtml(block, resolveReferences(session.snapshot));
    wrapper.addEventListener('click', e => { if ((e.target as Element).closest('a')) e.preventDefault(); }); parent.append(wrapper);
  };
  const editable = (parent: HTMLElement, target: TextTarget, tag: string) => {
    const wrapper = document.createElement(tag); wrapper.dataset.section = target.id; parent.append(wrapper);
    editors.push(new BlockEditor(session, target, wrapper, report));
  };
  for (const block of session.snapshot.blocks) {
    if (block.type === 'heading') {
      const target = targets.get(block);
      if (target) editable(host, target, `h${block.level}`); else readonly(host, block);
    } else if (block.type === 'paragraph' && targets.has(block)) editable(host, targets.get(block)!, 'div');
    else if (block.type === 'directive' && block.id) {
      const aside = document.createElement('aside'); aside.dataset.directive = block.id; host.append(aside);
      const label = document.createElement('header'); label.textContent = `${block.name} · ${block.id} · ${block.attributes.filter(a => a.key !== 'id').map(a => a.key + ': ' + a.value).join(' · ')}`; aside.append(label);
      for (const child of block.children) if (child.type === 'paragraph' && targets.has(child)) editable(aside, targets.get(child)!, 'div'); else readonly(aside, child);
    } else readonly(host, block);
  }
  return editors;
}
