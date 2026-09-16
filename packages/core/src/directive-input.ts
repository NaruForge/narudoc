import { ID_PATTERN, NaruError, readInput, readOperation, directiveInputSchema, validKey, wellFormed, type DirectiveInput, type InsertDirectiveOperation } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';

function invalid(message: string): never { throw new NaruError('NARU_ARGUMENT', message); }
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !wellFormed(value) || value.includes('\0')) invalid('Expected a well-formed Unicode string without NUL.');
}
function scalar(value: unknown, empty = false): asserts value is string {
  text(value);
  if ((!empty && !value) || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) invalid('Expected a trimmed single-line string.');
}
/** Runtime validation shared by the CLI and direct Core callers. */
export function readDirectiveInput(value: unknown): DirectiveInput {
  const input = readInput(directiveInputSchema, value);
  scalar(input.name); scalar(input.id);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.name)) invalid('Invalid directive name.');
  if (!ID_PATTERN.test(input.id)) invalid('Invalid directive ID.');
  for (const [key, val] of Object.entries(input.attributes)) {
    if (!validKey(key) || key === 'id') invalid('Invalid or repeated ID attribute.');
    scalar(val, true);
  }
  for (const child of input.children) {
    switch (child.type) {
      case 'paragraph': text(child.text); break;
      case 'list': {
        if (Object.hasOwn(child, 'start') && (!child.ordered || typeof child.start !== 'number' || !Number.isSafeInteger(child.start) || child.start < 0)) invalid('start is only allowed as a non-negative integer on ordered lists.');
        const start = child.start ?? 1;
        if (child.ordered && (start as number) + child.items.length - 1 > 999999999) invalid('Ordered list numbers must fit nine digits.');
        for (const item of child.items) scalar(item);
        break;
      }
      case 'code':
        text(child.value);
        if (child.language !== undefined) {
          scalar(child.language, true);
          if (child.language.includes('`')) invalid('Code language must not contain backticks.');
        }
        break;
      default: invalid('Unsupported directive child type.');
    }
  }
  return input;
}
export function readInsertDirective(value: unknown): InsertDirectiveOperation {
  const input = readOperation(value);
  if (input.type !== 'insertDirective') invalid('Expected insertDirective.');
  scalar(input.sectionId);
  readDirectiveInput({ name: input.name, id: input.id, attributes: input.attributes, children: input.children });
  return input;
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
