import type { Operation } from './operation-contract.js';
export * from './primitives.js';
export * from './operation-contract.js';
export { validateInput, inputObject, isInputObject, type InputSchema, type InputOf } from './input-schema.js';

/** All offsets are UTF-16 code units, half-open [start, end). */
export interface Range { start: number; end: number }
export interface Diagnostic { code: string; message: string; severity: 'error' | 'warning'; range: Range }
export type Inline = (
  | { type: 'text' | 'code'; value: string }
  | { type: 'emphasis' | 'strong'; children: Inline[] }
  | { type: 'reference'; targetId: string; targetRange?: Range; malformed?: boolean }
  | { type: 'link'; url: string; children: Inline[]; urlRange?: Range }) & { range?: Range };
export interface Attribute { key: string; value: string; range: Range; valueRange: Range }
interface Base { range: Range }
export interface Heading extends Base {
  type: 'heading'; level: number; title: string; titleRange: Range; inline: Inline[]; id?: string; idRange?: Range;
}
export interface Paragraph extends Base { type: 'paragraph'; inline: Inline[] }
export interface List extends Base { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
export interface Code extends Base { type: 'code'; language: string; value: string }
export interface TableCell extends Base { contentRange: Range; inline: Inline[] }
export interface TableRow extends Base { cells: TableCell[] }
export interface Table extends Base { type: 'table'; header: TableRow; separatorRange: Range; rows: TableRow[]; id?: string; caption?: string; annotationRange?: Range; idRange?: Range; captionRange?: Range; captionAttributeRange?: Range }
/** Single-line @figure annotation. src/alt ranges include their JSON quotes; idRange excludes them. */
export interface Figure extends Base {
  type: 'figure'; id: string; src: string; alt: string; caption?: string;
  idRange: Range; srcRange: Range; altRange: Range; captionRange?: Range; captionAttributeRange?: Range;
}
export type DirectiveBodyBlock = Paragraph | List | Code;
export interface Directive extends Base {
  type: 'directive'; name: string; id?: string; attributes: Attribute[]; children: DirectiveBodyBlock[]; headerEnd: number;
}
export interface Metadata extends Base { type: 'metadata'; attributes: Attribute[] }
export type Block = Heading | Paragraph | List | Code | Directive | Metadata | Table | Figure;
export interface DocumentSnapshot {
  source: string; blocks: Block[]; diagnostics: Diagnostic[]; eol: '\n' | '\r\n' | '\r';
}
export interface TextEdit extends Range { text: string; expected: string }
export interface Section extends Range { heading: Heading; parentStart: number | null }
export interface EditPlan { baseSource: string; edits: TextEdit[]; next: DocumentSnapshot }
export interface BatchRequest { schemaVersion: 1; operations: Operation[] }
/** Each step's edits use the source produced by the preceding step. */
export interface BatchStep { operationIndex: number; edits: TextEdit[] }
export interface BatchEditPlan { baseSource: string; steps: BatchStep[]; next: DocumentSnapshot }
export interface ReferenceDefinition { id: string; block: Block; number?: number; label?: string }
export interface ReferenceUse { block: Block; node: Extract<Inline, { type: 'link' | 'reference' }>; id: string; target?: ReferenceDefinition; label?: string }
export interface ReferenceContext { snapshot: DocumentSnapshot; blocks: ReadonlySet<Block>; definitions: ReferenceDefinition[]; references: ReferenceUse[]; diagnostics: Diagnostic[]; byNode: ReadonlyMap<Inline, ReferenceUse>; byBlock: ReadonlyMap<Block, ReferenceDefinition> }
export function inlineText(nodes: Inline[], context?: ReferenceContext): string {
  return nodes.map(n => n.type === 'reference' ? context?.byNode.get(n)?.label ?? `[@${n.targetId}]` : 'value' in n ? n.value : inlineText(n.children, context)).join('');
}
