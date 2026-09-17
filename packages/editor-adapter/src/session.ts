import { boundary, inlineText, NaruError, readOperation, type DocumentSnapshot, type Operation, type TextTarget } from '@naruforge/narudoc-model';
import { directSectionBody, getSection, getTable, parseDocument, planOperation, planSequence, textTarget, validateDocument } from '@naruforge/narudoc-core';

/** Offset within displayed inline text, never a source byte/DOM/ProseMirror position. */
export interface SelectionPoint { target: TextTarget; offset: number }
export interface SessionSelection { anchor: SelectionPoint; head: SelectionPoint; generation: number; epoch: number }
interface State { snapshot: DocumentSnapshot; journal: Operation[]; selection: SessionSelection | null }
interface Gesture { before: State; after: State; forward: Operation[]; inverse: Operation[] }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function structural(operation: Operation) {
  return !['setInlineText', 'setHeadingTitle', 'setTableCell', 'setDirectiveAttribute'].includes(operation.type);
}
function sameRun(a: Operation, b: Operation): boolean {
  return a.type === 'setInlineText' && b.type === 'setInlineText' && a.kind === b.kind && a.id === b.id && a.index === b.index && a.path === b.path && a.text === b.expected;
}

function paragraphs(doc: DocumentSnapshot, id: string) {
  return directSectionBody(doc, id).blocks.filter((block): block is Extract<typeof block, { type: 'paragraph' }> => block.type === 'paragraph');
}
function paragraphText(doc: DocumentSnapshot, id: string, index: number): string { return inlineText(paragraphs(doc, id)[index]!.inline); }
function selectedText(doc: DocumentSnapshot, id: string, from: { index: number; offset: number }, to: { index: number; offset: number }): string {
  const ps = paragraphs(doc, id), first = paragraphText(doc, id, from.index), last = paragraphText(doc, id, to.index);
  const middle = ps.slice(from.index + 1, to.index).map(p => inlineText(p.inline)).join('\n');
  return from.index === to.index ? first.slice(from.offset, to.offset) : first.slice(from.offset) + '\n' + (middle ? middle + '\n' : '') + last.slice(0, to.offset);
}
function inverseOperation(before: DocumentSnapshot, after: DocumentSnapshot, operation: Operation): Operation | undefined {
  switch (operation.type) {
    case 'setInlineText': return { ...operation, expected: operation.text, text: operation.expected };
    case 'setHeadingTitle': return { ...operation, title: getSection(before, operation.id).heading.title };
    case 'setTableCell': {
      const table = getTable(before, operation.sectionId, operation.tableIndex), row = operation.part === 'header' ? table.header : table.rows[operation.row], cell = row?.cells[operation.column];
      if (!cell) return undefined;
      return { ...operation, text: inlineText(cell.inline) };
    }
    case 'setDirectiveAttribute': {
      const block = before.blocks.find(candidate => 'id' in candidate && candidate.id === operation.id);
      if (!block || block.type !== 'directive') return undefined;
      const attr = block.attributes.find(candidate => candidate.key === operation.key);
      return attr ? { ...operation, value: attr.value } : undefined;
    }
    case 'renameId': return { type: 'renameId', id: operation.newId, newId: operation.id };
    case 'replaceParagraph': return { ...operation, text: before.source.slice(paragraphs(before, operation.id)[operation.index]!.range.start, paragraphs(before, operation.id)[operation.index]!.range.end) };
    case 'replaceDirectiveParagraph': {
      const block = before.blocks.find(candidate => 'id' in candidate && candidate.id === operation.id);
      if (!block || block.type !== 'directive') return undefined;
      const child = block.children.filter(candidate => candidate.type === 'paragraph')[operation.index];
      return child ? { ...operation, text: before.source.slice(child.range.start, child.range.end) } : undefined;
    }
    case 'splitParagraph': {
      const left = paragraphText(after, operation.id, operation.index), right = paragraphText(after, operation.id, operation.index + 1);
      return { type: 'joinParagraph', id: operation.id, index: operation.index, expected: left + '\n' + right };
    }
    case 'joinParagraph': return { type: 'splitParagraph', id: operation.id, index: operation.index, offset: paragraphText(before, operation.id, operation.index).length, expected: paragraphText(after, operation.id, operation.index) };
    case 'replaceParagraphRange': {
      const beforeParagraphs = paragraphs(before, operation.id), afterParagraphs = paragraphs(after, operation.id);
      const insertedCount = afterParagraphs.length - beforeParagraphs.length + operation.to.index - operation.from.index + 1;
      if (insertedCount < 1) return undefined;
      const first = paragraphText(before, operation.id, operation.from.index), last = paragraphText(before, operation.id, operation.to.index);
      const prefix = first.slice(0, operation.from.offset), suffix = last.slice(operation.to.offset);
      const inverseToIndex = operation.from.index + insertedCount - 1, inverseLast = paragraphText(after, operation.id, inverseToIndex);
      return { type: 'replaceParagraphRange', id: operation.id, from: { index: operation.from.index, offset: prefix.length }, to: { index: inverseToIndex, offset: inverseLast.length - suffix.length }, expected: selectedText(after, operation.id, { index: operation.from.index, offset: prefix.length }, { index: inverseToIndex, offset: inverseLast.length - suffix.length }), text: operation.expected };
    }
    case 'insertParagraph': {
      const afterParagraphs = paragraphs(after, operation.id);
      if (afterParagraphs.length < 2) return undefined;
      if (operation.index < afterParagraphs.length - 1) {
        const inserted = paragraphText(after, operation.id, operation.index);
        return { type: 'replaceParagraphRange', id: operation.id, from: { index: operation.index, offset: 0 }, to: { index: operation.index + 1, offset: 0 }, expected: inserted + '\n', text: '' };
      }
      const previous = paragraphText(after, operation.id, operation.index - 1), inserted = paragraphText(after, operation.id, operation.index);
      return { type: 'replaceParagraphRange', id: operation.id, from: { index: operation.index - 1, offset: previous.length }, to: { index: operation.index, offset: inserted.length }, expected: '\n' + inserted, text: '' };
    }
    case 'insertSection': return { type: 'removeSection', id: operation.id };
    case 'insertChildSection': return { type: 'removeSection', id: operation.id };
    case 'insertTable':
    case 'insertDirective':
    case 'removeSection':
    case 'moveSection':
      return undefined;
    default: { const exhaustive: never = operation; return exhaustive; }
  }
}

function inverseOperations(source: DocumentSnapshot, operations: Operation[]): Operation[] | undefined {
  let current = source; const inverse: Operation[] = [];
  for (const operation of operations) {
    const plan = planOperation(current, operation);
    const undo = inverseOperation(current, plan.next, operation);
    if (!undo) return undefined;
    inverse.unshift(undo);
    current = plan.next;
  }
  try {
    return planSequence(current, inverse, { collectSteps: false }).next.source === source.source ? inverse : undefined;
  } catch (error) {
    if (error instanceof NaruError) return undefined;
    throw error;
  }
}

/** Pure coordinator. Source/snapshot own meaning; projection drafts never become saved source. */
export class SourceSession {
  private current: DocumentSnapshot;
  private journal: Operation[] = [];
  private past: Gesture[] = [];
  private future: Gesture[] = [];
  private runBase: DocumentSnapshot | null = null;
  private selected: SessionSelection | null = null;
  private savedSource: string;
  private savedRevision: string | undefined;
  private checkpointPast: Gesture[] | null = null;
  generation = 0;
  epoch = 0;
  readonly listeners = new Set<() => void>();
  readonly drafts = new Map<string, string>();
  readonly coalesce: boolean;
  readonly historyLimit: number;
  constructor(source: string, options: { revision?: string; coalesce?: boolean; historyLimit?: number } = {}) {
    this.current = parseDocument(source); this.savedSource = source; this.savedRevision = options.revision;
    // Current UI uses PM block history. Document history is an explicit proof/next-client mode.
    this.coalesce = options.coalesce ?? true; this.historyLimit = options.historyLimit ?? 0;
    if (!Number.isSafeInteger(this.historyLimit) || this.historyLimit < 0) throw new NaruError('NARU_ARGUMENT', 'Invalid history limit.');
  }
  get snapshot() { return this.current; }
  get source() { return this.current.source; }
  get baseSource() { return this.savedSource; }
  get diskRevision() { return this.savedRevision; }
  get operations(): Operation[] { return copy(this.journal); }
  get selection(): SessionSelection | null { return this.selected ? copy(this.selected) : null; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get valid() { return !this.drafts.size && !validateDocument(this.current).some(d => d.severity === 'error'); }
  private state(): State { return { snapshot: this.current, journal: this.journal.slice(), selection: this.selection }; }
  private journalFromCheckpoint(): Operation[] {
    if (!this.checkpointPast) return this.journal.slice();
    let common = 0;
    while (common < this.checkpointPast.length && common < this.past.length && this.checkpointPast[common] === this.past[common]) common++;
    const result: Operation[] = [];
    for (let index = this.checkpointPast.length - 1; index >= common; index--) result.push(...this.checkpointPast[index]!.inverse);
    for (let index = common; index < this.past.length; index++) result.push(...this.past[index]!.forward);
    return result;
  }
  private checkGeneration(generation: number) {
    if (generation !== this.generation) throw new NaruError('NARU_STALE', 'Stale editor mapping; draft is preserved.');
  }
  select(anchor: SelectionPoint, head = anchor, generation = this.generation, epoch = this.epoch) {
    this.checkGeneration(generation);
    if (epoch !== this.epoch) throw new NaruError('NARU_STALE', 'Selection belongs to a replaced structure.');
    for (const point of [anchor, head]) {
      const value = inlineText(textTarget(this.current, point.target).inline);
      if (!boundary(value, point.offset)) throw new NaruError('NARU_TARGET', 'Selection offset is out of range or splits Unicode.');
    }
    this.selected = copy({ anchor, head, generation, epoch });
  }
  apply(operation: Operation, generation = this.generation) { this.gesture([operation], generation); }
  /** One user intent: all operations prepare successfully before any listener/history publication. */
  gesture(requests: readonly Operation[], generation = this.generation) {
    this.checkGeneration(generation);
    const plan = planSequence(this.current, requests, { collectSteps: false });
    // Own validated DTOs, including nested arrays; callers cannot rewrite a future save replay.
    const operations = requests.map(request => copy(readOperation(request)));
    if (plan.next.source === this.source) return;
    const before = this.state();
    let nextJournal = [...this.journal, ...operations], runBase: DocumentSnapshot | null = null;
    const operation = operations.length === 1 ? operations[0] : undefined;
    const previous = this.journal.at(-1);
    if (operation?.type === 'setInlineText') {
      runBase = this.current;
      if (this.coalesce && previous?.type === 'setInlineText' && this.runBase && sameRun(previous, operation)) {
        const combined: Operation = { ...previous, text: operation.text };
        try {
          // A matching path is insufficient: leaf deletion/gap changes must preserve exact source.
          if (planOperation(this.runBase, combined).next.source === plan.next.source) {
            nextJournal = [...this.journal.slice(0, -1), combined]; runBase = this.runBase;
          }
        } catch (error) { if (!(error instanceof NaruError)) throw error; }
      }
    }
    this.current = plan.next; this.journal = nextJournal; this.runBase = runBase;
    this.generation++;
    if (operations.some(structural)) this.epoch++;
    // A projection can publish a newly mapped selection after the gesture. Never guess offsets.
    this.selected = null;
    if (this.historyLimit > 0) {
      const inverse = inverseOperations(before.snapshot, operations);
      if (inverse) {
        this.past.push({ before, after: this.state(), forward: operations, inverse });
        if (this.past.length > this.historyLimit) this.past.shift();
      } else {
        // A gesture without a byte-exact semantic inverse is an explicit history barrier.
        // Its journal remains saveable, but no snapshot-only undo may cross it.
        this.past = []; this.future = []; this.checkpointPast = null;
      }
    }
    this.future = [];
    if (this.checkpointPast) this.journal = this.journalFromCheckpoint();
    this.notify();
  }
  private restore(state: State) {
    this.current = state.snapshot; this.journal = this.checkpointPast ? this.journalFromCheckpoint() : state.journal.slice(); this.runBase = null;
    this.generation++; this.epoch++;
    this.selected = state.selection ? { ...copy(state.selection), generation: this.generation, epoch: this.epoch } : null;
    this.notify();
  }
  /** Internal document-gesture proof; the current product still exposes per-block PM history. */
  undoGesture(): boolean {
    if (this.drafts.size) throw new NaruError('NARU_ARGUMENT', 'Resolve projection drafts before document undo.');
    const gesture = this.past.pop(); if (!gesture) return false;
    gesture.after.selection = this.selection; this.future.push(gesture); this.restore(gesture.before); return true;
  }
  redoGesture(): boolean {
    if (this.drafts.size) throw new NaruError('NARU_ARGUMENT', 'Resolve projection drafts before document redo.');
    const gesture = this.future.pop(); if (!gesture) return false;
    this.past.push(gesture); this.restore(gesture.after); return true;
  }
  /** Explicit host rebase (reload/save acknowledgement): invalidate projections and current history. */
  replace(source: string, revision?: string) {
    this.current = parseDocument(source); this.savedSource = source; this.savedRevision = revision;
    this.journal = []; this.past = []; this.future = []; this.checkpointPast = null; this.runBase = null; this.selected = null;
    this.generation++; this.epoch++; this.notify();
  }
  /** A successful file commit changes the replay base but keeps document undo/redo. */
  acknowledgeSave(source: string, revision?: string) {
    if (source !== this.source) throw new NaruError('NARU_STALE', 'Saved source does not match the current session.');
    this.savedSource = source; this.savedRevision = revision; this.journal = []; this.checkpointPast = this.past.slice(); this.runBase = null; this.notify();
  }
  notify() { for (const listener of this.listeners) listener(); }
}
