import { boundary, inlineText, NaruError, readOperation, type DocumentSnapshot, type Operation, type TextTarget } from '@naruforge/narudoc-model';
import { parseDocument, planOperation, planSequence, textTarget, validateDocument } from '@naruforge/narudoc-core';

/** Offset within displayed inline text, never a source byte/DOM/ProseMirror position. */
export interface SelectionPoint { target: TextTarget; offset: number }
export interface SessionSelection { anchor: SelectionPoint; head: SelectionPoint; generation: number; epoch: number }
interface State { snapshot: DocumentSnapshot; journal: Operation[]; selection: SessionSelection | null }
interface Gesture { before: State; after: State }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function structural(operation: Operation) {
  return !['setInlineText', 'setHeadingTitle', 'setTableCell', 'setDirectiveAttribute'].includes(operation.type);
}
function sameRun(a: Operation, b: Operation): boolean {
  return a.type === 'setInlineText' && b.type === 'setInlineText' && a.kind === b.kind && a.id === b.id && a.index === b.index && a.path === b.path && a.text === b.expected;
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
      this.past.push({ before, after: this.state() });
      if (this.past.length > this.historyLimit) this.past.shift();
    }
    this.future = [];
    this.notify();
  }
  private restore(state: State) {
    this.current = state.snapshot; this.journal = state.journal.slice(); this.runBase = null;
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
    this.journal = []; this.past = []; this.future = []; this.runBase = null; this.selected = null;
    this.generation++; this.epoch++; this.notify();
  }
  notify() { for (const listener of this.listeners) listener(); }
}
