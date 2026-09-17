import type { Operation, DirectiveInput, TextTarget } from '../../packages/model/dist/index.js';
const valid: Operation = { type: 'setTableCell', sectionId: 'a', tableIndex: 0, part: 'body', row: 0, column: 0, text: 'x' };
// @ts-expect-error enum comes from the executable definition
const enumError: Operation = { ...valid, part: 'footer' };
// @ts-expect-error required field comes from the executable definition
const missing: Operation = { type: 'replaceParagraph', id: 'a', text: 'x' };
// @ts-expect-error index has a numeric input type
const typeError: TextTarget = { kind: 'paragraph', id: 'a', index: '0' };
const dto: DirectiveInput = { name: 'note', id: 'N', attributes: {}, children: [{ type: 'code', value: 'x' }, { type: 'list', ordered: true, items: ['x'] }] };
// @ts-expect-error authoring input has no parsed source range
const parsedDto: DirectiveInput = { ...dto, range: { start: 0, end: 1 } };
void [valid, enumError, missing, typeError, dto, parsedDto];
