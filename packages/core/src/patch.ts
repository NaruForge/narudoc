import { boundary, NaruError, wellFormed, type EditPlan, type TextEdit } from '@naruforge/narudoc-model';

export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let last: TextEdit | undefined;
  for (const edit of ordered) {
    if (!boundary(source, edit.start) || !boundary(source, edit.end) || edit.end < edit.start || !wellFormed(edit.text)) throw new NaruError('NARU_PATCH', 'Invalid edit range or Unicode boundary.');
    if (last && (edit.start < last.end || edit.start === last.start)) throw new NaruError('NARU_PATCH', 'Overlapping or ambiguous edits.');
    if (source.slice(edit.start, edit.end) !== edit.expected) throw new NaruError('NARU_STALE', 'Edit target no longer matches its expected text.');
    last = edit;
  }
  let next = source;
  for (const edit of ordered.reverse()) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  return next;
}
export function applyPlan(source: string, plan: EditPlan): string {
  if (source !== plan.baseSource) throw new NaruError('NARU_STALE', 'Document changed after planning.');
  return applyTextEdits(source, plan.edits);
}
/** Shrink a replacement without splitting UTF-16 surrogate pairs. */
export function minimalEdit(source: string, start: number, end: number, text: string): TextEdit[] {
  const old = source.slice(start, end);
  if (old === text) return [];
  let prefix = 0;
  while (prefix < old.length && prefix < text.length && old[prefix] === text[prefix]) prefix++;
  while (!boundary(old, prefix) || !boundary(text, prefix)) prefix--;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < text.length - prefix && old[old.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
  while (!boundary(old, old.length - suffix) || !boundary(text, text.length - suffix)) suffix--;
  return [{ start: start + prefix, end: end - suffix, text: text.slice(prefix, text.length - suffix), expected: old.slice(prefix, old.length - suffix) }];
}
