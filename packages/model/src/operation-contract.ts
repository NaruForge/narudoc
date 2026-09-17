import { NaruError } from './primitives.js';
import { inputObject, isInputObject, readInput, validateInput, type InputOf, type InputSchema } from './input-schema.js';

const string = (description: string) => ({ type: 'string', description } as const);
const index = (description: string) => ({ type: 'integer', minimum: 0, description } as const);
const id = string('Existing public stable ID; re-query after rename.');
const newId = string('New document-unique ID; does not rename an existing object.');
const text = string('Authored text; Core validates its document context.');
const paragraphIndex = index('Zero-based direct paragraph index in this step snapshot; lists/code/tables do not count. Earlier insertions shift it.');
const textTargetFields = { kind: { type: 'string', enum: ['heading', 'paragraph', 'directiveParagraph'], description: 'Text container kind; heading index is zero.' }, id, index: paragraphIndex } as const;
export const textTargetSchema = inputObject(textTargetFields, ['kind', 'id', 'index']);
export const tableInputSchema = inputObject({
  headers: { type: 'array', minItems: 1, items: text, description: 'Nonempty header cells; Core checks cell grammar.' },
  rows: { type: 'array', items: { type: 'array', items: text }, description: 'Body rows; each must match header width.' },
}, ['headers', 'rows']);
export const directiveChildSchema = { oneOf: [
  inputObject({ type: { enum: ['paragraph'] }, text }, ['type', 'text']),
  inputObject({ type: { enum: ['list'] }, ordered: { type: 'boolean' }, start: index('Ordered lists only; default 1.'), items: { type: 'array', minItems: 1, items: text } }, ['type', 'ordered', 'items']),
  inputObject({ type: { enum: ['code'] }, language: string('Optional fence language; default empty.'), value: text }, ['type', 'value']),
] } as const;
export const directiveInputSchema = inputObject({
  name: string('Generic directive name; no domain schema is implied.'), id: newId,
  attributes: { type: 'object', additionalProperties: string('Generic single-line attribute value; id/reserved keys are rejected by Core.') },
  children: { type: 'array', items: directiveChildSchema, description: 'Authored body blocks; source ranges are parser-owned.' },
}, ['name', 'id', 'attributes', 'children']);

function operation<const S extends InputSchema>(input: S, details: {
  description: string; target: string; effect: string; retry: string; example: InputOf<S>; advanced?: boolean;
}) { return { input, ...details }; }
const requery = 'On stale/target failure, re-read the document and plan against the current snapshot; do not blindly retry.';
const createRetry = 'Re-read before retry: an insertion can duplicate content or collide with an existing ID.';
const paragraphFields = { id, index: paragraphIndex, text };
export const operationDefinitions = {
  setInlineText: operation(inputObject({ ...textTargetFields, path: string('Advanced dot-separated inline index path in this snapshot.'), expected: string('Exact previous ordinary text; empty denotes a semantic gap.'), text }, ['kind', 'id', 'index', 'path', 'expected', 'text']), {
    description: 'Edit one ordinary inline text run without rewriting markup.', target: 'snapshot-relative text target/path', effect: 'Minimal text patch; protected markup cannot change.', retry: requery, advanced: true,
    example: { kind: 'paragraph', id: 'control', index: 0, path: '0', expected: 'A.', text: 'A revised.' },
  }),
  insertTable: operation(inputObject({ sectionId: id, ...tableInputSchema.properties }, ['sectionId', 'headers', 'rows']), {
    description: 'Append a bounded pipe table to a section direct body.', target: 'section stable ID', effect: 'Insert new table source only.', retry: createRetry,
    example: { sectionId: 'control', headers: ['Parameter', 'Value'], rows: [['Voltage', '400']] },
  }),
  setTableCell: operation(inputObject({ sectionId: id, tableIndex: index('Zero-based direct table index in this step snapshot.'), part: { type: 'string', enum: ['header', 'body'], description: 'Header or body cell; header row must be zero.' }, row: index('Zero-based row within part.'), column: index('Zero-based column.'), text }, ['sectionId', 'tableIndex', 'part', 'row', 'column', 'text']), {
    description: 'Change one table cell while preserving separator and padding.', target: 'section ID + snapshot-relative table/cell coordinates', effect: 'Minimal cell-content patch.', retry: requery,
    example: { sectionId: 'control', tableIndex: 0, part: 'body', row: 0, column: 1, text: '420' },
  }),
  insertDirective: operation(inputObject({ sectionId: id, ...directiveInputSchema.properties }, ['sectionId', 'name', 'id', 'attributes', 'children']), {
    description: 'Append a generic directive from an authoring object.', target: 'section stable ID', effect: 'Insert one new directive; status remains a generic string.', retry: createRetry,
    example: { sectionId: 'control', name: 'requirement', id: 'REQ-NEW', attributes: { status: 'draft' }, children: [{ type: 'paragraph', text: 'Check the voltage.' }] },
  }),
  renameId: operation(inputObject({ id, newId }, ['id', 'newId']), { description: 'Rename an ID and its parsed internal references together.', target: 'stable ID', effect: 'Patch definition and actual internal link destinations atomically.', retry: requery, example: { id: 'control', newId: 'control-v2' } }),
  setHeadingTitle: operation(inputObject({ id, title: text }, ['id', 'title']), { description: 'Change a heading title, retaining its ID and spacing.', target: 'section stable ID', effect: 'Minimal title patch.', retry: requery, example: { id: 'control', title: 'Control design' } }),
  insertSection: operation(inputObject({ after: id, id: newId, title: text }, ['after', 'id', 'title']), { description: 'Insert a sibling section after an existing section.', target: 'after stable ID', effect: 'Insert a new heading after the complete section.', retry: createRetry, example: { after: 'control', id: 'design', title: 'Design' } }),
  insertChildSection: operation(inputObject({ parent: id, id: newId, title: text }, ['parent', 'id', 'title']), { description: 'Add a child after the parent’s existing descendants.', target: 'parent stable ID', effect: 'Insert a new heading at parent level + 1.', retry: createRetry, example: { parent: 'control', id: 'design', title: 'Design' } }),
  removeSection: operation(inputObject({ id }, ['id']), { description: 'Remove a section and its descendants.', target: 'section stable ID', effect: 'Delete section slice; dangling references cause failure.', retry: requery, example: { id: 'details' } }),
  moveSection: operation(inputObject({ id, after: id }, ['id', 'after']), { description: 'Move a section after a sibling without serializing its contents.', target: 'two sibling stable IDs', effect: 'Move source slices; preserve internal bytes.', retry: requery, example: { id: 'second', after: 'third' } }),
  replaceParagraph: operation(inputObject(paragraphFields, ['id', 'index', 'text']), { description: 'Replace one direct section paragraph.', target: 'section ID + snapshot-relative paragraph index', effect: 'Minimal paragraph patch; exact source no-op preserves mixed EOL.', retry: requery, example: { id: 'control', index: 0, text: 'A revised.' } }),
  insertParagraph: operation(inputObject(paragraphFields, ['id', 'index', 'text']), { description: 'Insert a paragraph before index, or append at paragraph count.', target: 'section ID + snapshot-relative insertion index', effect: 'Insert source; later paragraph indices shift.', retry: createRetry, example: { id: 'control', index: 0, text: 'New paragraph.' } }),
  replaceDirectiveParagraph: operation(inputObject(paragraphFields, ['id', 'index', 'text']), { description: 'Replace a paragraph inside a generic directive.', target: 'directive ID + snapshot-relative paragraph index', effect: 'Minimal body patch; header and sibling blocks remain unchanged.', retry: requery, example: { id: 'REQ-1', index: 0, text: 'Check revised voltage.' } }),
  setDirectiveAttribute: operation(inputObject({ id, key: string('Generic attribute key; use renameId for id.'), value: string('Trimmed single-line value, including empty.') }, ['id', 'key', 'value']), { description: 'Set a generic directive attribute.', target: 'directive stable ID', effect: 'Patch/add one attribute; no requirement-specific validation.', retry: requery, example: { id: 'REQ-1', key: 'status', value: 'verified' } }),
} as const;
export type OperationName = keyof typeof operationDefinitions;
export type Operation = { [K in OperationName]: { type: K } & InputOf<typeof operationDefinitions[K]['input']> }[OperationName];
export type TextTarget = InputOf<typeof textTargetSchema>;
export type SetInlineTextOperation = Extract<Operation, { type: 'setInlineText' }>;
export type TableInput = InputOf<typeof tableInputSchema>;
export type DirectiveChildInput = InputOf<typeof directiveChildSchema>;
export type DirectiveInput = InputOf<typeof directiveInputSchema>;
export type InsertDirectiveOperation = Extract<Operation, { type: 'insertDirective' }>;
export function operationSchema(name: OperationName): InputSchema {
  const input = operationDefinitions[name].input;
  return { type: 'object', properties: { type: { enum: [name] }, ...input.properties }, required: ['type', ...input.required], additionalProperties: false };
}
export function readOperation(value: unknown): Operation {
  if (!isInputObject(value) || typeof value.type !== 'string' || !Object.hasOwn(operationDefinitions, value.type)) throw new NaruError('NARU_ARGUMENT', '$.type: Expected a supported operation.');
  validateInput(operationSchema(value.type as OperationName), value);
  return value as Operation;
}
export { readInput };
