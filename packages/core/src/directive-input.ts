import { ID_PATTERN, NaruError, validKey, wellFormed, type DirectiveInput, type InsertDirectiveOperation } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';

function invalid(message: string): never { throw new NaruError('NARU_ARGUMENT', message); }
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid('Unexpected or missing directive input fields.');
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !wellFormed(value) || value.includes('\0')) invalid('Expected a well-formed Unicode string without NUL.');
}
function scalar(value: unknown, empty = false): asserts value is string {
  text(value);
  if ((!empty && !value) || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) invalid('Expected a trimmed single-line string.');
}
/** Runtime validation shared by the CLI and direct Core callers. */
export function readDirectiveInput(value: unknown): DirectiveInput {
  fields(value, ['name', 'id', 'attributes', 'children']);
  scalar(value.name); scalar(value.id);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.name)) invalid('Invalid directive name.');
  if (!ID_PATTERN.test(value.id)) invalid('Invalid directive ID.');
  if (!object(value.attributes)) invalid('attributes must be an object.');
  for (const [key, val] of Object.entries(value.attributes)) {
    if (!validKey(key) || key === 'id') invalid('Invalid or repeated ID attribute.');
    scalar(val, true);
  }
  if (!Array.isArray(value.children)) invalid('children must be an array.');
  for (const child of value.children) {
    if (!object(child)) invalid('Expected a child object.');
    switch (child.type) {
      case 'paragraph': fields(child, ['type', 'text']); text(child.text); break;
      case 'list': {
        fields(child, ['type', 'ordered', 'items'], ['start']);
        if (typeof child.ordered !== 'boolean' || !Array.isArray(child.items) || !child.items.length) invalid('Expected a nonempty flat list.');
        if (Object.hasOwn(child, 'start') && (!child.ordered || typeof child.start !== 'number' || !Number.isSafeInteger(child.start) || child.start < 0)) invalid('start is only allowed as a non-negative integer on ordered lists.');
        const start = child.start ?? 1;
        if (child.ordered && (start as number) + child.items.length - 1 > 999999999) invalid('Ordered list numbers must fit nine digits.');
        for (const item of child.items) scalar(item);
        break;
      }
      case 'code':
        fields(child, ['type', 'value'], ['language']); text(child.value);
        if (Object.hasOwn(child, 'language')) {
          scalar(child.language, true);
          if (child.language.includes('`')) invalid('Code language must not contain backticks.');
        }
        break;
      default: invalid('Unsupported directive child type.');
    }
  }
  return value as unknown as DirectiveInput;
}
export function readInsertDirective(value: unknown): InsertDirectiveOperation {
  fields(value, ['type', 'sectionId', 'name', 'id', 'attributes', 'children']);
  if (value.type !== 'insertDirective') invalid('Expected insertDirective.');
  scalar(value.sectionId);
  readDirectiveInput({ name: value.name, id: value.id, attributes: value.attributes, children: value.children });
  return value as unknown as InsertDirectiveOperation;
}

/** Only newly authored content is serialized; existing document slices are never serialized. */
export function directiveSource(input: DirectiveInput, eol: string): string {
  const normalize = (value: string) => value.replace(/\r\n|\r|\n/g, eol);
  const children = input.children.map(child => {
    let fragment: string;
    switch (child.type) {
      case 'paragraph': fragment = normalize(child.text); break;
      case 'list': fragment = child.items.map((item, index) => `${child.ordered ? `${(child.start ?? 1) + index}.` : '-'} ${item}`).join(eol); break;
      case 'code': {
        const value = normalize(child.value);
        let length = 3;
        for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
        const fence = '`'.repeat(length);
        fragment = fence + (child.language ?? '') + eol + value + (value && !value.endsWith(eol) ? eol : '') + fence;
        break;
      }
    }
    // Check the actual directive context, including literal heading/metadata lines.
    const prefix = `:::check${eol}${eol}`;
    const parsed = parseDocument(prefix + fragment + eol + ':::');
    const wrapper = parsed.blocks[0];
    const node = wrapper?.type === 'directive' ? wrapper.children[0] : undefined;
    if (parsed.diagnostics.some(d => d.severity === 'error') || parsed.blocks.length !== 1 ||
        wrapper?.type !== 'directive' || wrapper.children.length !== 1 || node?.type !== child.type ||
        node.range.start !== prefix.length || node.range.end !== prefix.length + fragment.length) invalid('Child must serialize to exactly one directive body block.');
    return fragment;
  });
  const header = [`:::${input.name}`, `id: ${input.id}`, ...Object.entries(input.attributes).map(([key, value]) => `${key}: ${value}`)].join(eol);
  return header + eol + (children.length ? eol + children.join(eol + eol) + eol : '') + ':::';
}
