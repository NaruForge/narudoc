import { Schema, type Mark, type Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { boundary, inlineText, NaruError, type Block, type DocumentSnapshot, type Inline, type Operation, type TextTarget } from '@naruforge/narudoc-model';
import { planOperation, textTarget, textTargets } from '@naruforge/narudoc-core';
import { renderBlockHtml } from '@naruforge/narudoc-renderer-html';
import { SourceSession } from './session.js';

const targetKey = (target: TextTarget): string => JSON.stringify(target);
const DOCUMENT_DRAFT = 'document-projection';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    heading: {
      content: 'inline*', group: 'block',
      attrs: { level: { default: 1 }, target: { default: '' }, label: { default: '' } },
      toDOM: node => [`h${node.attrs.level}`, { role: 'textbox', 'aria-label': node.attrs.label, 'data-target': node.attrs.target }, 0],
    },
    paragraph: {
      content: 'inline*', group: 'block',
      attrs: { target: { default: '' }, label: { default: '' }, container: { default: 'section' } },
      toDOM: node => ['p', { role: 'textbox', 'aria-label': node.attrs.label, 'data-target': node.attrs.target, class: node.attrs.container === 'directive' ? 'directive-paragraph' : '' }, 0],
    },
    protectedBlock: {
      group: 'block', atom: true, selectable: false, attrs: { html: { default: '' }, label: { default: '' } },
      toDOM: node => ['div', { class: 'readonly-block', 'aria-label': node.attrs.label }, node.attrs.label],
    },
    protectedInline: {
      inline: true, group: 'inline', atom: true, selectable: false, attrs: { label: {}, kind: {} },
      leafText: node => String(node.attrs.label ?? ''),
      toDOM: node => ['span', { class: 'protected-inline', contenteditable: 'false', title: 'Protected ' + node.attrs.kind }, node.attrs.label],
    },
    text: { group: 'inline' },
  },
  marks: { strong: { toDOM: () => ['strong', 0] }, emphasis: { toDOM: () => ['em', 0] } },
});

interface Projection { doc: PMNode; source: string }
interface ProjectionBlock { node: PMNode; pos: number; start: number; end: number; target?: TextTarget; text: string; key: string }
interface Point { target: TextTarget; offset: number }
interface Cursor { target: TextTarget; offset: number }
type VirtualEdit =
  | { kind: 'paragraphSplit'; target: TextTarget; offset: number; original: string }
  | { kind: 'headingParagraph'; target: { kind: 'paragraph'; id: string; index: number } };
interface InlineMapping { path: string; from: number; to: number; value: string }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function protectedHtml(snapshot: DocumentSnapshot, block: Block): { html: string; label: string } {
  if (block.type === 'metadata') return { html: `<pre>${escapeHtml(snapshot.source.slice(block.range.start, block.range.end))}</pre>`, label: 'Read-only metadata' };
  return { html: renderBlockHtml(block), label: `Read-only ${block.type}` };
}

function protectedChildHtml(snapshot: DocumentSnapshot, block: Block): { html: string; label: string } {
  return protectedHtml(snapshot, block);
}

function inlineNodes(snapshot: DocumentSnapshot, nodes: Inline[], prefix = '', marks: Mark[] = []): PMNode[] {
  return nodes.flatMap((node, index): PMNode[] => {
    const path = prefix + index;
    if (node.type === 'strong' || node.type === 'emphasis') return inlineNodes(snapshot, node.children, path + '.', [...marks, schema.marks[node.type]!.create()]);
    if (node.type === 'text' && node.range && snapshot.source.slice(node.range.start, node.range.end) === node.value && !/[\r\n]/.test(node.value)) {
      return node.value ? [schema.text(node.value, marks)] : [];
    }
    return [schema.nodes.protectedInline!.create({ label: inlineText([node]), kind: node.type }, null, marks)];
  });
}

function editableHeading(snapshot: DocumentSnapshot, target: TextTarget, block: Extract<Block, { type: 'heading' }>): PMNode {
  return schema.nodes.heading!.create({ level: block.level, target: targetKey(target), label: `${target.kind} ${target.id} ${target.index}` }, inlineNodes(snapshot, block.inline));
}

function editableParagraph(snapshot: DocumentSnapshot, target: TextTarget, block: Extract<Block, { type: 'paragraph' }>, container = 'section'): PMNode {
  return schema.nodes.paragraph!.create({ target: targetKey(target), label: `${target.kind} ${target.id} ${target.index}`, container }, inlineNodes(snapshot, block.inline));
}

function blockProjection(snapshot: DocumentSnapshot): Projection {
  const targets = new Map(textTargets(snapshot).map(item => [item.block, item.target]));
  const nodes: PMNode[] = [];
  const addProtected = (block: Block, html = protectedHtml(snapshot, block)) => nodes.push(schema.nodes.protectedBlock!.create(html));
  for (const block of snapshot.blocks) {
    if (block.type === 'heading') {
      const target = targets.get(block);
      if (target) nodes.push(editableHeading(snapshot, target, block)); else addProtected(block);
      continue;
    }
    if (block.type === 'paragraph') {
      const target = targets.get(block);
      if (target) nodes.push(editableParagraph(snapshot, target, block)); else addProtected(block);
      continue;
    }
    if (block.type !== 'directive') { addProtected(block); continue; }
    const header = escapeHtml(`${block.name}${block.id ? ` · ${block.id}` : ''}`);
    nodes.push(schema.nodes.protectedBlock!.create({ html: `<aside><header>${header}</header></aside>`, label: `${block.name} ${block.id ?? ''}`.trim() }));
    for (const child of block.children) {
      const target = child.type === 'paragraph' ? targets.get(child) : undefined;
      if (child.type === 'paragraph' && target) nodes.push(editableParagraph(snapshot, target, child, 'directive'));
      else addProtected(child, protectedChildHtml(snapshot, child));
    }
  }
  if (!nodes.length) nodes.push(schema.nodes.protectedBlock!.create({ html: '<div class="readonly-block">Empty document</div>', label: 'Empty document' }));
  return { doc: schema.nodes.doc!.create(null, nodes), source: snapshot.source };
}

function targetFrom(node: PMNode): TextTarget | undefined {
  if ((node.type.name !== 'paragraph' && node.type.name !== 'heading') || !node.attrs.target) return undefined;
  try { return JSON.parse(node.attrs.target) as TextTarget; } catch { return undefined; }
}

function displayLength(node: PMNode): number {
  if (node.isText) return node.text?.length ?? 0;
  if (node.type.name === 'protectedInline') return String(node.attrs.label ?? '').length;
  return node.textContent.length;
}

function displayText(node: PMNode): string {
  let value = '';
  node.forEach(child => { value += child.isText ? child.text ?? '' : child.type.name === 'protectedInline' ? String(child.attrs.label ?? '') : child.textContent; });
  return value;
}

function blocks(doc: PMNode): ProjectionBlock[] {
  const result: ProjectionBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
    const target = targetFrom(node);
    if (!target) return true;
    result.push({ node, pos, start: pos + 1, end: pos + node.nodeSize - 1, target, text: displayText(node), key: targetKey(target) });
    return false;
  });
  return result;
}

function blockAt(position: number, list: ProjectionBlock[], preferNext: boolean): ProjectionBlock | undefined {
  for (let index = 0; index < list.length; index++) {
    const current = list[index]!, next = list[index + 1];
    if (position >= current.start && position <= current.end) return current;
    if (next && position > current.end && position < next.start) return preferNext ? next : current;
  }
  return list.at(-1);
}

function offsetAt(block: ProjectionBlock, position: number): number {
  let offset = 0, result = block.text.length, done = false;
  block.node.forEach((child, childOffset) => {
    if (done) return;
    const start = block.start + childOffset, end = start + child.nodeSize, length = displayLength(child);
    if (position <= start) { result = offset; done = true; return; }
    if (position < end) { result = child.isText ? offset + Math.max(0, position - start) : offset; done = true; return; }
    offset += length; result = offset;
  });
  return result;
}

function positionForOffset(doc: PMNode, target: TextTarget, offset: number): number | undefined {
  const block = blocks(doc).find(item => item.key === targetKey(target));
  if (!block || offset < 0 || offset > block.text.length) return undefined;
  let display = 0, result = block.end, done = false;
  block.node.forEach((child, childOffset) => {
    if (done) return;
    const length = displayLength(child), start = block.start + childOffset;
    if (offset <= display + length) {
      result = child.isText ? start + offset - display : offset === display ? start : endPosition(child, start); done = true;
      return;
    }
    display += length;
  });
  return result;
}

function endPosition(node: PMNode, start: number): number { return start + node.nodeSize; }

function commonPrefix(left: string, right: string): number {
  let value = 0; while (value < left.length && value < right.length && left[value] === right[value]) value++;
  while (value > 0 && !boundary(left, value)) value--; return value;
}

function commonSuffix(left: string, right: string, prefix: number): number {
  let value = 0; while (value < left.length - prefix && value < right.length - prefix && left[left.length - value - 1] === right[right.length - value - 1]) value++;
  while (value > 0 && (!boundary(left, left.length - value) || !boundary(right, right.length - value))) value--; return value;
}

function pmInlineSource(node: PMNode): string {
  let value = '';
  node.forEach(child => {
    if (child.isText) {
      let text = (child.text ?? '').replace(/\\/g, '\\\\').replace(/[`*\[\]()]/g, '\\$&');
      for (const mark of child.marks.slice().reverse()) text = mark.type.name === 'strong' ? `**${text}**` : mark.type.name === 'emphasis' ? `*${text}*` : text;
      value += text;
    } else throw new NaruError('NARU_ARGUMENT', 'A protected inline cannot be promoted from a projection draft.');
  });
  return value;
}

function plainParagraphText(node: PMNode): string {
  return pmInlineSource(node);
}

function pasteParts(text: string): string[] {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  return normalized === '\n' ? ['', ''] : normalized.split('\n').filter(Boolean);
}

function inlineMappings(snapshot: DocumentSnapshot, target: TextTarget): InlineMapping[] {
  const mappings: InlineMapping[] = [];
  let offset = 0;
  function visit(nodes: Inline[], prefix = '') {
    nodes.forEach((node, index) => {
      const path = prefix + index;
      mappings.push({ path, from: offset, to: offset, value: '' });
      if (node.type === 'strong' || node.type === 'emphasis') { visit(node.children, path + '.'); return; }
      const length = inlineText([node]).length;
      if (node.type === 'text' && node.range && snapshot.source.slice(node.range.start, node.range.end) === node.value && !/[\r\n]/.test(node.value)) {
        mappings.push({ path, from: offset, to: offset + length, value: node.value });
      }
      offset += length;
    });
    mappings.push({ path: prefix + nodes.length, from: offset, to: offset, value: '' });
  }
  visit(textTarget(snapshot, target).inline);
  return mappings;
}

export interface DocumentEditorHandle { target: TextTarget; view: EditorView }

export class DocumentEditor {
  readonly view: EditorView;
  readonly handles: DocumentEditorHandle[];
  private baseline: Projection;
  private composing = false;
  private committing = false;
  private destroyed = false;
  private virtual: VirtualEdit | null = null;
  private unsubscribe: () => void;

  constructor(readonly session: SourceSession, readonly host: HTMLElement, readonly report: (message: string) => void) {
    this.baseline = blockProjection(session.snapshot);
    this.view = new EditorView(host, {
      state: EditorState.create({ schema, doc: this.baseline.doc }),
      attributes: { role: 'document', 'aria-label': 'NaruDoc document' },
      nodeViews: { protectedBlock: node => new ProtectedBlockView(node) },
      dispatchTransaction: transaction => this.dispatch(transaction),
      handleTextInput: (_view, from, to, text) => this.applyRange(from, to, text),
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        event.preventDefault();
        return this.applyRange(this.view.state.selection.from, this.view.state.selection.to, text);
      },
      handleKeyDown: (_view, event) => this.keyDown(event),
      handleDrop: () => { this.report('Drag/drop is not supported.'); return true; },
      handleDOMEvents: {
        compositionstart: () => { this.composing = true; this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent); this.session.notify(); return false; },
        compositionend: () => { setTimeout(() => { this.composing = false; this.commitView(); }, 0); return false; },
        cut: (_view, event) => {
          const selection = this.view.state.selection;
          if (selection.empty) return false;
          const text = this.view.state.doc.textBetween(selection.from, selection.to, '\n', leaf => String(leaf.attrs.label ?? ''));
          event.clipboardData?.setData('text/plain', text); event.preventDefault();
          return this.applyRange(selection.from, selection.to, '');
        },
      },
    });
    this.handles = textTargets(session.snapshot).map(item => ({ target: item.target, view: this.view }));
    const listener = () => {
      if (this.committing || this.composing || this.session.drafts.has(DOCUMENT_DRAFT)) return;
      if (this.session.source !== this.baselineSource()) this.syncFromSession();
    };
    session.listeners.add(listener); this.unsubscribe = () => session.listeners.delete(listener);
  }

  private baselineSource(): string { return this.baseline.source; }

  private dispatch(transaction: Transaction) {
    if (this.destroyed) return;
    this.view.updateState(this.view.state.apply(transaction));
    if (!transaction.docChanged) return;
    this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent);
    this.session.notify();
    if (!this.composing) this.commitView();
  }

  private currentBlocks() { return blocks(this.view.state.doc); }
  private baselineBlocks() { return blocks(this.baseline.doc); }

  private pointRange(from: number, to: number): { from: ProjectionBlock; to: ProjectionBlock; start: Point; end: Point; expected: string } | undefined {
    const list = this.currentBlocks();
    const first = blockAt(from, list, false), last = blockAt(to, list, true);
    if (!first || !last || !first.target || !last.target || first.target.kind !== 'paragraph' || last.target.kind !== 'paragraph' || first.target.id !== last.target.id) {
      this.report('Only a selection within adjacent direct paragraphs of one section is editable.'); return undefined;
    }
    const start = { target: first.target, offset: offsetAt(first, from) }, end = { target: last.target, offset: offsetAt(last, to) };
    if (start.target.index > end.target.index || (start.target.index === end.target.index && start.offset > end.offset)) return undefined;
    const paragraphText = list.filter(item => item.target?.kind === 'paragraph' && item.target.id === first.target!.id).map(item => item.text);
    const middle = paragraphText.slice(start.target.index + 1, end.target.index).join('\n');
    const expected = start.target.index === end.target.index
      ? first.text.slice(start.offset, end.offset)
      : first.text.slice(start.offset) + '\n' + (middle ? middle + '\n' : '') + last.text.slice(0, end.offset);
    return { from: first, to: last, start, end, expected };
  }

  private applyRange(from: number, to: number, text: string): boolean {
    if (this.composing || this.virtual) return false;
    const heading = this.headingRange(from, to);
    if (heading) {
      const operation: Operation = { type: 'setHeadingTitle', id: heading.start.target.id, title: heading.block.text.slice(0, heading.start.offset) + text + heading.block.text.slice(heading.end.offset) };
      const cursor = { target: heading.start.target, offset: heading.start.offset + text.length };
      if (!this.commitOperations([operation], cursor)) this.retainDraft(from, to, text);
      return true;
    }
    const single = this.singleTargetRange(from, to);
    if (single?.start.target.kind === 'directiveParagraph') {
      const draft = this.view.state.tr.insertText(text, from, to).doc;
      this.commitInlineDraft(single.start.target, single.start.offset, single.end.offset, text, draft, { target: single.start.target, offset: single.start.offset + text.length });
      return true;
    }
    const range = this.pointRange(from, to); if (!range) return true;
    const operation: Operation = { type: 'replaceParagraphRange', id: range.start.target.id, from: { index: range.start.target.index, offset: range.start.offset }, to: { index: range.end.target.index, offset: range.end.offset }, expected: range.expected, text };
    try {
      const parts = pasteParts(text);
      const cursor: Cursor = parts.length > 1
        ? { target: { kind: 'paragraph', id: range.start.target.id, index: range.start.target.index + parts.length - 1 }, offset: parts.at(-1)!.length }
        : { target: range.start.target, offset: range.start.offset + (parts[0]?.length ?? 0) };
      if (!this.commitOperations([operation], cursor)) this.retainDraft(from, to, text);
      return true;
    } catch (error) { this.report((error as Error).message); return true; }
  }

  private singleTargetRange(from: number, to: number): { block: ProjectionBlock; start: Point; end: Point } | undefined {
    const list = this.currentBlocks(), startBlock = blockAt(from, list, false), endBlock = blockAt(to, list, true);
    if (!startBlock || startBlock !== endBlock || !startBlock.target) return undefined;
    return { block: startBlock, start: { target: startBlock.target, offset: offsetAt(startBlock, from) }, end: { target: startBlock.target, offset: offsetAt(startBlock, to) } };
  }

  private commitInlineDraft(target: TextTarget, from: number, to: number, text: string, draft: PMNode, cursor: Cursor): boolean {
    let failure: unknown;
    for (const mapping of inlineMappings(this.session.snapshot, target).filter(item => from >= item.from && to <= item.to)) {
      try {
        const operation: Operation = { type: 'setInlineText', ...target, path: mapping.path, expected: mapping.value, text: mapping.value.slice(0, from - mapping.from) + text + mapping.value.slice(to - mapping.from) };
        const candidate = planOperation(this.session.snapshot, operation);
        if (blockProjection(candidate.next).doc.eq(draft)) return this.commitOperations([operation], cursor);
      } catch (error) { failure = error; }
    }
    this.report((failure as Error | undefined)?.message ?? 'Only ordinary text edits inside one inline run are supported.');
    return false;
  }

  private headingRange(from: number, to: number): { block: ProjectionBlock; start: Point; end: Point } | undefined {
    const list = this.currentBlocks(), startBlock = blockAt(from, list, false), endBlock = blockAt(to, list, true);
    if (!startBlock || startBlock !== endBlock || !startBlock.target || startBlock.target.kind !== 'heading') return undefined;
    return { block: startBlock, start: { target: startBlock.target, offset: offsetAt(startBlock, from) }, end: { target: startBlock.target, offset: offsetAt(startBlock, to) } };
  }

  private retainDraft(from: number, to: number, text: string) {
    this.committing = true;
    try { this.view.updateState(this.view.state.apply(this.view.state.tr.insertText(text, from, to))); }
    finally { this.committing = false; }
    this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent); this.session.notify();
  }

  private keyDown(event: KeyboardEvent): boolean {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); try { (event.shiftKey ? this.session.redoGesture() : this.session.undoGesture()); this.syncFromSession(); } catch (error) { this.report((error as Error).message); } return true;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); try { this.session.redoGesture(); this.syncFromSession(); } catch (error) { this.report((error as Error).message); } return true;
    }
    const selection = this.view.state.selection;
    if (!selection.empty && (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const position = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? selection.from : selection.to;
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, position)));
      return true;
    }
    if ((event.key === 'Home' || event.key === 'End') && selection.empty) {
      const current = blockAt(selection.from, this.currentBlocks(), false);
      const target = current?.target;
      if (target) {
        event.preventDefault();
        const position = positionForOffset(this.view.state.doc, target, event.key === 'Home' ? 0 : current.text.length);
        if (position !== undefined) this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, position)));
        return true;
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!selection.empty) return this.applyRange(selection.from, selection.to, '\n');
      const heading = this.headingRange(selection.from, selection.to);
      if (heading) {
        if (heading.start.offset !== heading.block.text.length) { this.report('Enter is supported only at the end of a heading.'); return true; }
        const insertAt = heading.block.pos + heading.block.node.nodeSize, next = this.view.state.doc.nodeAt(insertAt);
        if (next?.type.name === 'protectedBlock') { this.report('A protected block boundary cannot be crossed.'); return true; }
        const target = { kind: 'paragraph' as const, id: heading.start.target.id, index: 0 };
        const node = schema.nodes.paragraph!.create({ target: targetKey(target), label: `paragraph ${target.id} 0`, container: 'section' });
        this.virtual = { kind: 'headingParagraph', target };
        const transaction = this.view.state.tr.insert(insertAt, node);
        transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 1)); this.view.dispatch(transaction); return true;
      }
      const range = this.pointRange(selection.from, selection.to); if (!range || range.start.target.index !== range.end.target.index) return true;
      const text = range.from.text;
      if (range.start.offset > 0 && range.start.offset < text.length) {
        try { this.commitOperations([{ type: 'splitParagraph', id: range.start.target.id, index: range.start.target.index, offset: range.start.offset, expected: text }], { target: { kind: 'paragraph', id: range.start.target.id, index: range.start.target.index + 1 }, offset: 0 }); } catch (error) { this.report((error as Error).message); }
        return true;
      }
      this.virtual = { kind: 'paragraphSplit', target: range.start.target, offset: range.start.offset, original: text };
      this.view.dispatch(this.view.state.tr.split(selection.from)); return true;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      if (!selection.empty) return this.applyRange(selection.from, selection.to, '');
      const single = this.singleTargetRange(selection.from, selection.to);
      if (single && single.start.target.kind !== 'paragraph') {
        const value = single.block.text, offset = single.start.offset;
        const start = event.key === 'Backspace' ? previousOffset(value, offset) : offset;
        const end = event.key === 'Backspace' ? offset : nextOffset(value, offset);
        if (start !== end) return this.applyRange(positionForOffset(this.view.state.doc, single.start.target, start)!, positionForOffset(this.view.state.doc, single.start.target, end)!, '');
        return true;
      }
      const range = this.pointRange(selection.from, selection.to); if (!range) return true;
      const target = range.start.target, block = range.from, value = block.text, offset = range.start.offset;
      if (event.key === 'Backspace' && offset === 0 && target.index > 0) {
        const previous = { kind: 'paragraph' as const, id: target.id, index: target.index - 1 };
        const left = this.currentBlocks().find(item => item.key === targetKey(previous));
        if (!left) return true;
        if (block.pos !== left.pos + left.node.nodeSize) { this.report('A protected block boundary cannot be crossed.'); return true; }
        try { this.commitOperations([{ type: 'joinParagraph', id: target.id, index: target.index - 1, expected: left.text + '\n' + value }], { target: previous, offset: left.text.length + value.length }); } catch (error) { this.report((error as Error).message); }
        return true;
      }
      if (event.key === 'Delete' && offset === value.length) {
        const next = { kind: 'paragraph' as const, id: target.id, index: target.index + 1 };
        const right = this.currentBlocks().find(item => item.key === targetKey(next));
        if (right) {
          if (right.pos !== block.pos + block.node.nodeSize) { this.report('A protected block boundary cannot be crossed.'); return true; }
          try { this.commitOperations([{ type: 'joinParagraph', id: target.id, index: target.index, expected: value + '\n' + right.text }], { target, offset: value.length }); } catch (error) { this.report((error as Error).message); }
          return true;
        }
      }
      const start = event.key === 'Backspace' ? previousOffset(value, offset) : offset;
      const end = event.key === 'Backspace' ? offset : nextOffset(value, offset);
      if (start !== end) return this.applyRange(positionForOffset(this.view.state.doc, target, start)!, positionForOffset(this.view.state.doc, target, end)!, '');
      return true;
    }
    return false;
  }

  private commitView() {
    if (this.committing || this.destroyed) return;
    const current = this.currentBlocks(), base = this.baselineBlocks();
    if (sameKeys(current, base)) {
      const changed = current.filter((item, index) => item.text !== base[index]?.text);
      if (!changed.length) { this.session.drafts.delete(DOCUMENT_DRAFT); this.session.notify(); return; }
      const first = base.findIndex(item => item.key === changed[0]!.key), last = base.findIndex(item => item.key === changed.at(-1)!.key);
      if (first < 0 || last < first) return;
      const oldFirst = base[first]!, newFirst = current[first]!, oldLast = base[last]!, newLast = current[last]!;
      const prefix = commonPrefix(oldFirst.text, newFirst.text), suffix = commonSuffix(oldLast.text, newLast.text, first === last ? prefix : 0);
      if (first === last && oldFirst.target?.kind === 'heading') {
        const operation: Operation = { type: 'setHeadingTitle', id: oldFirst.target.id, title: newFirst.text };
        try {
          const candidate = planOperation(this.session.snapshot, operation);
          if (blockProjection(candidate.next).doc.eq(this.view.state.doc)) this.commitOperations([operation], { target: oldFirst.target, offset: newFirst.text.length - suffix });
        } catch (error) { this.report((error as Error).message); }
        return;
      }
      if (first === last && oldFirst.target?.kind === 'directiveParagraph') {
        this.commitInlineDraft(oldFirst.target, prefix, oldFirst.text.length - suffix, newFirst.text.slice(prefix, newFirst.text.length - suffix), this.view.state.doc, { target: oldFirst.target, offset: newFirst.text.length - suffix });
        return;
      }
      if (oldFirst.target?.kind !== 'paragraph' || oldLast.target?.kind !== 'paragraph') return;
      const oldMiddle = base.slice(first + 1, last).map(item => item.text).join('\n'), newMiddle = current.slice(first + 1, last).map(item => item.text).join('\n');
      const operation: Operation = { type: 'replaceParagraphRange', id: oldFirst.target!.id, from: { index: oldFirst.target!.index, offset: prefix }, to: { index: oldLast.target!.index, offset: oldLast.text.length - suffix }, expected: first === last ? oldFirst.text.slice(prefix, oldFirst.text.length - suffix) : oldFirst.text.slice(prefix) + '\n' + (oldMiddle ? oldMiddle + '\n' : '') + oldLast.text.slice(0, oldLast.text.length - suffix), text: first === last ? newFirst.text.slice(prefix, newFirst.text.length - suffix) : newFirst.text.slice(prefix) + '\n' + (newMiddle ? newMiddle + '\n' : '') + newLast.text.slice(0, newLast.text.length - suffix) };
      this.commitOperations([operation], { target: operation.from.index === operation.to.index ? oldFirst.target! : oldLast.target!, offset: operation.from.index === operation.to.index ? prefix + (operation.text as string).length : (operation.text as string).length });
      return;
    }
    this.commitVirtual(current, base);
  }

  private commitVirtual(current: ProjectionBlock[], base: ProjectionBlock[]) {
    if (!this.virtual) return;
    if (this.virtual.kind === 'headingParagraph') {
      const inserted = current.find(item => item.key === targetKey(this.virtual!.target));
      if (!inserted?.text) { this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent); this.session.notify(); return; }
      try {
        this.commitOperations([{ type: 'insertParagraph', id: this.virtual.target.id, index: 0, text: plainParagraphText(inserted.node) }], { target: this.virtual.target, offset: inserted.text.length });
        this.virtual = null;
      } catch (error) { this.report((error as Error).message); }
      return;
    }
    const key = targetKey(this.virtual.target), index = base.findIndex(item => item.key === key);
    if (index < 0 || base[index]!.target?.kind !== 'paragraph') return;
    const pair = current[index]?.key === key && current[index + 1]?.key === key ? [current[index]!, current[index + 1]!] as [ProjectionBlock, ProjectionBlock] : undefined;
    const boundaryMatches = pair && (this.virtual.offset === 0
      ? pair[1].text === this.virtual.original
      : this.virtual.offset === this.virtual.original.length
        ? pair[0].text === this.virtual.original
        : pair[0].text + pair[1].text === this.virtual.original);
    if (!pair || !boundaryMatches) {
      this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent); this.session.notify(); return;
    }
    const old = base[index]!, oldTarget = old.target!, left = pair[0].text, right = pair[1].text;
    try {
      const operations: Operation[] = [];
      let cursor: Cursor | undefined;
      if (this.virtual.offset === 0 && left) {
        operations.push({ type: 'insertParagraph', id: oldTarget.id, index: oldTarget.index, text: plainParagraphText(pair[0].node) });
        cursor = { target: { kind: 'paragraph', id: oldTarget.id, index: oldTarget.index }, offset: left.length };
      } else if (this.virtual.offset === old.text.length && right) {
        operations.push({ type: 'insertParagraph', id: oldTarget.id, index: oldTarget.index + 1, text: plainParagraphText(pair[1].node) });
        cursor = { target: { kind: 'paragraph', id: oldTarget.id, index: oldTarget.index + 1 }, offset: right.length };
      }
      else if (left && right) operations.push({ type: 'splitParagraph', id: oldTarget.id, index: oldTarget.index, offset: this.virtual.offset, expected: old.text });
      else { this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent); this.session.notify(); return; }
      this.commitOperations(operations, cursor); this.virtual = null;
    } catch (error) { this.report((error as Error).message); }
  }

  private commitOperations(operations: Operation[], cursor?: Cursor): boolean {
    this.committing = true;
    try { this.session.gesture(operations); this.session.drafts.delete(DOCUMENT_DRAFT); this.syncFromSession(cursor); this.report(''); return true; }
    catch (error) { this.report((error as Error).message); this.session.drafts.set(DOCUMENT_DRAFT, this.view.state.doc.textContent); this.session.notify(); return false; }
    finally { this.committing = false; }
  }

  private syncFromSession(cursor?: Cursor) {
    if (this.destroyed) return;
    const projection = blockProjection(this.session.snapshot); this.baseline = projection; this.virtual = null;
    this.handles.splice(0, this.handles.length, ...textTargets(this.session.snapshot).map(item => ({ target: item.target, view: this.view })));
    let state = EditorState.create({ schema, doc: projection.doc });
    if (cursor) {
      const position = positionForOffset(projection.doc, cursor.target, cursor.offset);
      if (position !== undefined) state = state.apply(state.tr.setSelection(TextSelection.create(projection.doc, position)));
    }
    this.view.updateState(state);
    this.session.drafts.delete(DOCUMENT_DRAFT); this.session.notify();
  }

  destroy() { this.destroyed = true; this.unsubscribe(); this.view.destroy(); }
}

function sameKeys(left: ProjectionBlock[], right: ProjectionBlock[]): boolean { return left.length === right.length && left.every((item, index) => item.key === right[index]?.key); }
function previousOffset(value: string, offset: number): number { return offset > 0 && value.charCodeAt(offset - 1) >= 0xdc00 && value.charCodeAt(offset - 1) <= 0xdfff ? offset - 2 : Math.max(0, offset - 1); }
function nextOffset(value: string, offset: number): number { return offset < value.length && value.charCodeAt(offset) >= 0xd800 && value.charCodeAt(offset) <= 0xdbff ? offset + 2 : Math.min(value.length, offset + 1); }

class ProtectedBlockView {
  readonly dom: HTMLElement;
  constructor(node: PMNode) {
    this.dom = document.createElement('div'); this.dom.className = 'readonly-block'; this.dom.innerHTML = node.attrs.html;
    this.dom.addEventListener('click', event => { if ((event.target as Element).closest('a')) event.preventDefault(); });
  }
  ignoreMutation() { return true; }
  stopEvent() { return true; }
}

export function mountDocumentProjection(host: HTMLElement, session: SourceSession, report: (message: string) => void): DocumentEditor {
  return new DocumentEditor(session, host, report);
}
