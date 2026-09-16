/** All offsets are UTF-16 code units, half-open [start, end). */
export interface Range { start: number; end: number }
export interface Diagnostic { code: string; message: string; severity: 'error' | 'warning'; range: Range }
export type Inline =
  | { type: 'text' | 'code'; value: string }
  | { type: 'emphasis' | 'strong'; children: Inline[] }
  | { type: 'link'; url: string; children: Inline[] };
export interface Attribute { key: string; value: string; range: Range; valueRange: Range }
interface Base { range: Range }
export interface Heading extends Base {
  type: 'heading'; level: number; title: string; titleRange: Range; inline: Inline[]; id?: string;
}
export interface Paragraph extends Base { type: 'paragraph'; inline: Inline[] }
export interface List extends Base { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
export interface Code extends Base { type: 'code'; language: string; value: string }
export interface Directive extends Base {
  type: 'directive'; name: string; id?: string; attributes: Attribute[]; body: Inline[]; headerEnd: number;
}
export interface Metadata extends Base { type: 'metadata'; attributes: Attribute[] }
export type Block = Heading | Paragraph | List | Code | Directive | Metadata;
export interface DocumentSnapshot {
  source: string; blocks: Block[]; diagnostics: Diagnostic[]; eol: '\n' | '\r\n' | '\r';
}
export interface TextEdit extends Range { text: string; expected: string }
export interface Section extends Range { heading: Heading; parentStart: number | null }
export type Operation =
  | { type: 'setHeadingTitle'; id: string; title: string }
  | { type: 'insertSection'; after: string; id: string; title: string }
  | { type: 'removeSection'; id: string }
  | { type: 'moveSection'; id: string; after: string }
  | { type: 'replaceParagraph'; id: string; index: number; text: string }
  | { type: 'setDirectiveAttribute'; id: string; key: string; value: string };
export interface EditPlan { baseSource: string; edits: TextEdit[]; next: DocumentSnapshot }
export interface BatchRequest { schemaVersion: 1; operations: Operation[] }
/** Each step's edits use the source produced by the preceding step. */
export interface BatchStep { operationIndex: number; edits: TextEdit[] }
export interface BatchEditPlan { baseSource: string; steps: BatchStep[]; next: DocumentSnapshot }
export class NaruError extends Error {
  constructor(public readonly code: string, message: string, public readonly diagnostics: Diagnostic[] = []) {
    super(message); this.name = 'NaruError';
  }
}
export class BatchOperationError extends NaruError {
  constructor(public readonly operationIndex: number, cause: NaruError) {
    super(cause.code, `Operation ${operationIndex}: ${cause.message}`, cause.diagnostics);
    this.name = 'BatchOperationError';
  }
}
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function validKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key);
}
export function inlineText(nodes: Inline[]): string {
  return nodes.map(n => 'value' in n ? n.value : inlineText(n.children)).join('');
}
export function boundary(source: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  const a = source.charCodeAt(offset - 1), b = source.charCodeAt(offset);
  return !(a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff);
}
export function wellFormed(source: string): boolean {
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
