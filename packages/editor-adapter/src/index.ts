import { Schema, type Node as PMNode, type Mark } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
export { undo, redo } from 'prosemirror-history';
import { inlineText, NaruError, type DocumentSnapshot, type Inline, type Operation, type TextTarget } from '@naruforge/narudoc-model';
import { parseDocument, planOperation, textTarget, validateDocument } from '@naruforge/narudoc-core';
import { renderBlockHtml } from '@naruforge/narudoc-renderer-html';

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
  const mappings: Mapping[] = [];
  let position = 1;
  function visit(nodes: Inline[], prefix = '', marks: Mark[] = []): PMNode[] {
    return nodes.flatMap((node, index): PMNode[] => {
      const path = prefix + index;
      if (node.type === 'strong' || node.type === 'emphasis') return visit(node.children, path + '.', [...marks, schema.marks[node.type]!.create()]);
      if (node.type === 'text' && node.range && snapshot.source.slice(node.range.start, node.range.end) === node.value && !/[\r\n]/.test(node.value)) {
        mappings.push({ path, from: position, to: position + node.value.length, value: node.value });
        position += node.value.length;
        return node.value ? [schema.text(node.value, marks)] : [];
      }
      position++;
      return [schema.nodes.protected!.create({ label: inlineText([node]), kind: node.type }, null, marks)];
    });
  }
  const content = visit(textTarget(snapshot, target).inline);
  return { doc: schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, content)), mappings };
}

/** Source is canonical. Operations are retained for a host to replay through Core at save time. */
export class SourceSession {
  snapshot: DocumentSnapshot;
  generation = 0;
  operations: Operation[] = [];
  listeners = new Set<() => void>();
  drafts = new Map<string, string>();
  constructor(source: string) { this.snapshot = parseDocument(source); }
  get source() { return this.snapshot.source; }
  get valid() { return !this.drafts.size && !validateDocument(this.snapshot).some(d => d.severity === 'error'); }
  apply(operation: Operation, generation = this.generation) {
    if (generation !== this.generation) throw new NaruError('NARU_STALE', 'Stale editor mapping; draft is preserved.');
    const plan = planOperation(this.snapshot, operation);
    this.snapshot = plan.next;
    if (plan.edits.length) this.operations.push(operation);
    this.generation++;
    this.notify();
  }
  replace(source: string) { this.snapshot = parseDocument(source); this.operations = []; this.generation++; this.notify(); }
  notify() { for (const listener of this.listeners) listener(); }
}

export class BlockEditor {
  view: EditorView;
  private baseline: ReturnType<typeof projection>;
  private generation: number;
  private composing = false;
  private committing = false;
  private destroyed = false;
  readonly key: string;
  private unsubscribe: () => void;
  constructor(readonly session: SourceSession, readonly target: TextTarget, host: HTMLElement, readonly report: (message: string) => void) {
    this.key = JSON.stringify(target); this.generation = session.generation;
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
    if (!tr.docChanged) return;
    this.session.drafts.set(this.key, this.view.state.doc.textContent);
    if (!this.composing) this.commit(); else this.session.notify();
  }
  commit() {
    const draft = this.view.state.doc;
    if (draft.eq(this.baseline.doc)) { this.session.drafts.delete(this.key); this.report(''); this.session.notify(); return; }
    try {
      if (this.generation !== this.session.generation) throw new NaruError('NARU_STALE', 'Stale snapshot/mapping; draft preserved. Reload explicitly to replace it.');
      const from = this.baseline.doc.content.findDiffStart(draft.content);
      const end = this.baseline.doc.content.findDiffEnd(draft.content);
      if (from === null || !end) throw new NaruError('NARU_ARGUMENT', 'Unsupported edit.');
      // findDiffEnd can overlap start for pure insertion/deletion.
      const overlap = Math.max(0, from - Math.min(end.a, end.b));
      const oldEnd = end.a + overlap, newEnd = end.b + overlap;
      const mapping = this.baseline.mappings.find(m => from >= m.from && oldEnd <= m.to);
      if (!mapping) throw new NaruError('NARU_ARGUMENT', 'Protected inline or markup boundary edit is unsupported.');
      const inserted = draft.textBetween(from, newEnd, '\n', '\uFFFC');
      const text = mapping.value.slice(0, from - mapping.from) + inserted + mapping.value.slice(oldEnd - mapping.from);
      const op: Operation = { type: 'setInlineText', ...this.target, path: mapping.path, expected: mapping.value, text };
      const candidate = planOperation(this.session.snapshot, op);
      const projected = projection(candidate.next, this.target);
      if (!projected.doc.eq(draft)) throw new NaruError('NARU_ARGUMENT', 'Only ordinary text edits inside one inline run are supported.');
      this.committing = true;
      this.session.apply(op, this.generation);
      this.baseline = projected; this.generation = this.session.generation;
      this.session.drafts.delete(this.key); this.report('');
    } catch (error) { this.session.drafts.set(this.key, draft.textContent); this.report((error as Error).message); }
    finally { this.committing = false; this.session.notify(); }
  }
  destroy() { this.destroyed = true; this.unsubscribe(); this.view.destroy(); }
}

/** Display unsupported blocks with the safe renderer; never import/export DOM as source. */
export function mountDocument(host: HTMLElement, session: SourceSession, report: (message: string) => void): BlockEditor[] {
  host.replaceChildren(); const editors: BlockEditor[] = [];
  let sectionId: string | undefined, paragraphIndex = 0;
  const readonly = (parent: HTMLElement, block: Parameters<typeof renderBlockHtml>[0]) => {
    const wrapper = document.createElement('div'); wrapper.className = 'readonly-block'; wrapper.title = 'Read only';
    wrapper.innerHTML = renderBlockHtml(block); wrapper.addEventListener('click', e => { if ((e.target as Element).closest('a')) e.preventDefault(); }); parent.append(wrapper);
  };
  const editable = (parent: HTMLElement, target: TextTarget, tag: string) => {
    const wrapper = document.createElement(tag); wrapper.dataset.section = target.id; parent.append(wrapper);
    editors.push(new BlockEditor(session, target, wrapper, report));
  };
  for (const block of session.snapshot.blocks) {
    if (block.type === 'heading') {
      sectionId = block.id; paragraphIndex = 0;
      if (block.id) editable(host, { kind: 'heading', id: block.id, index: 0 }, `h${block.level}`); else readonly(host, block);
    } else if (block.type === 'paragraph' && sectionId) editable(host, { kind: 'paragraph', id: sectionId, index: paragraphIndex++ }, 'div');
    else if (block.type === 'directive' && block.id) {
      const aside = document.createElement('aside'); aside.dataset.directive = block.id; host.append(aside);
      const label = document.createElement('header'); label.textContent = `${block.name} · ${block.id} · ${block.attributes.filter(a => a.key !== 'id').map(a => a.key + ': ' + a.value).join(' · ')}`; aside.append(label);
      let index = 0;
      for (const child of block.children) if (child.type === 'paragraph') editable(aside, { kind: 'directiveParagraph', id: block.id, index: index++ }, 'div'); else readonly(aside, child);
    } else readonly(host, block);
  }
  return editors;
}
