import { NaruError, operationDefinitions, operationSchema, readOperation, validateInput, type InputSchema, type Operation, type OperationName } from '@naruforge/narudoc-model';

type Binding<K extends OperationName> = { command: string; fields: { [P in keyof Omit<Extract<Operation, { type: K }>, 'type'>]: string | { from: string } } };
/** Only client spelling lives here. Domain field types, requiredness, enums and examples do not. */
export const operationBindings = {
  setInlineText: { command: 'text set', fields: { kind: 'kind', id: 'id', index: 'index', path: 'path', expected: 'expected', text: 'text' } },
  insertTable: { command: 'table insert', fields: { sectionId: 'section', headers: { from: 'from' }, rows: { from: 'from' } } },
  setTableCell: { command: 'table set-cell', fields: { sectionId: 'section', tableIndex: 'index', part: 'part', row: 'row', column: 'column', text: 'text' } },
  insertDirective: { command: 'directive insert', fields: { sectionId: 'section', name: { from: 'from' }, id: { from: 'from' }, attributes: { from: 'from' }, children: { from: 'from' } } },
  renameId: { command: 'id rename', fields: { id: 'id', newId: 'new-id' } },
  setHeadingTitle: { command: 'heading set-title', fields: { id: 'id', title: 'title' } },
  insertSection: { command: 'section insert', fields: { after: 'after', id: 'id', title: 'title' } },
  insertChildSection: { command: 'section insert-child', fields: { parent: 'parent', id: 'id', title: 'title' } },
  removeSection: { command: 'section remove', fields: { id: 'id' } },
  moveSection: { command: 'section move', fields: { id: 'id', after: 'after' } },
  replaceParagraph: { command: 'paragraph replace', fields: { id: 'id', index: 'index', text: 'text' } },
  insertParagraph: { command: 'paragraph insert', fields: { id: 'id', index: 'index', text: 'text' } },
  replaceDirectiveParagraph: { command: 'directive replace-paragraph', fields: { id: 'id', index: 'index', text: 'text' } },
  setDirectiveAttribute: { command: 'directive set', fields: { id: 'id', key: 'key', value: 'value' } },
} satisfies { [K in OperationName]: Binding<K> };
interface Option { type: 'string' | 'boolean'; required: boolean; description: string; schema?: InputSchema }
interface Command { description: string; options: Record<string, Option>; example: string; operation?: OperationName; file: boolean }
const option = (description: string, required = false, type: 'string' | 'boolean' = 'string'): Option => ({ description, required, type });
const stdin = option('Read stdin instead of a file.', false, 'boolean');
const revision = option('Expected lowercase SHA-256 of original bytes; on stale re-read before replanning.');
const dryRun = option('Plan/validate without writing; does not guarantee save will succeed.', false, 'boolean');
const writes = { revision, 'dry-run': dryRun };
export const hostCommands: Record<string, Command> = {
  edit: { description: 'Open one local file in the visual editor.', options: { 'no-open': option('Print URL without launching a browser.', false, 'boolean'), port: option('Loopback port, 0..65535; default 0.') }, example: 'narudoc edit practice.narudoc --no-open', file: true },
  inspect: { description: 'Inspect parsed blocks and diagnostics as JSON.', options: { stdin }, example: 'narudoc inspect practice.narudoc --json', file: true },
  outline: { description: 'List section IDs, titles and hierarchy.', options: { stdin }, example: 'narudoc outline practice.narudoc --json', file: true },
  get: { description: 'Read an ID target; headings include their whole section.', options: { stdin, id: option('Stable ID to query.', true) }, example: 'narudoc get practice.narudoc --id control --json', file: true },
  'table get': { description: 'Read one direct table by section and index.', options: { stdin, section: option('Section stable ID.', true), index: option('Zero-based direct table index.', true) }, example: 'narudoc table get practice.narudoc --section control --index 0 --json', file: true },
  validate: { description: 'Check document syntax, IDs and references.', options: { stdin }, example: 'narudoc validate practice.narudoc --json', file: true },
  render: { description: 'Render safe HTML to stdout or a new file.', options: { stdin, to: option('html is the only supported format.', true), output: option('New output path; never overwrite.') }, example: 'narudoc render practice.narudoc --to html --output practice.html', file: true },
  new: { description: 'Create a new file without overwriting an existing file.', options: { title: option('Title, default Untitled.'), id: option('New stable ID, default document.') }, example: 'narudoc new practice.narudoc --title Control --id control', file: true },
  batch: { description: 'Plan 1..100 sequential operations and save once on success.', options: { operations: option('JSON plan file or - for stdin.', true), revision: { ...revision, required: true }, 'dry-run': dryRun }, example: 'narudoc batch practice.narudoc --operations plan.json --revision SHA256 --dry-run --json', file: true },
  capabilities: { description: 'Discover operations; select one for schema, example and retry meaning.', options: { operation: option('Semantic operation name; omit for a short list.') }, example: 'narudoc capabilities --operation setTableCell --json', file: false },
};
export function checkBindings(definitions: Record<string, { input: InputSchema }>, bindings: Record<string, { command: string; fields: Record<string, unknown> }>): void {
  if (JSON.stringify(Object.keys(definitions).sort()) !== JSON.stringify(Object.keys(bindings).sort())) throw Error('Operation/binding coverage drift.');
  const names = new Set<string>();
  for (const [name, definition] of Object.entries(definitions)) {
    const binding = bindings[name]!;
    if (names.has(binding.command) || Object.hasOwn(hostCommands, binding.command)) throw Error('Duplicate CLI command.');
    names.add(binding.command);
    if (JSON.stringify(Object.keys(definition.input.properties ?? {}).sort()) !== JSON.stringify(Object.keys(binding.fields).sort())) throw Error(`${name}: semantic field/binding drift.`);
  }
}
const quote = (value: unknown) => JSON.stringify(String(value));
export function operationExample(name: OperationName) {
  const binding = operationBindings[name], example = operationDefinitions[name].example as Record<string, unknown>;
  const args: string[] = binding.command.split(' ').concat('practice.narudoc');
  const json: Record<string, unknown> = {};
  for (const [field, input] of Object.entries(binding.fields)) {
    if (typeof input === 'string') args.push('--' + input, String(example[field]));
    else json[field] = example[field];
  }
  if (Object.keys(json).length) args.push('--from', 'input.json');
  return { args, json, command: 'narudoc ' + args.map(arg => /^[\w./-]+$/.test(arg) ? arg : quote(arg)).join(' ') + ' --dry-run --json' };
}
export function createCommands(): Record<string, Command> {
  checkBindings(operationDefinitions, operationBindings);
  const commands = { ...hostCommands };
  for (const name of Object.keys(operationDefinitions) as OperationName[]) {
    const definition = operationDefinitions[name], binding = operationBindings[name];
    const properties: Record<string, InputSchema> = definition.input.properties;
    const options: Record<string, Option> = {};
    for (const [field, input] of Object.entries(binding.fields)) {
      if (typeof input !== 'string') options[input.from] = option('Authoring JSON object from file or -; see example below.', true);
      else options[input] = { ...option(properties[field]!.description ?? field, (definition.input.required as readonly string[]).includes(field)), schema: properties[field]! };
    }
    commands[binding.command] = { operation: name, description: definition.description, options: { ...options, ...writes }, example: operationExample(name).command, file: true };
  }
  return commands;
}
export const commands = createCommands();
export const parseOptions = Object.fromEntries([
  ...Object.values(commands).flatMap(command => Object.entries(command.options).map(([key, value]) => [key, { type: value.type }] as const)),
  ...['json', 'help', 'version'].map(key => [key, { type: 'boolean' as const }] as const),
]);
export async function bindOperation(command: string, values: Record<string, string | boolean | undefined>, readJson: (file: string) => Promise<unknown>): Promise<Operation> {
  const name = commands[command]?.operation;
  if (!name) throw new NaruError('NARU_ARGUMENT', 'Unknown operation.');
  const definition = operationDefinitions[name], binding = operationBindings[name];
  const request: Record<string, unknown> = { type: name };
  const properties: Record<string, InputSchema> = definition.input.properties;
  const dtoFields: Record<string, InputSchema> = {};
  let from: string | undefined;
  for (const [field, input] of Object.entries(binding.fields)) {
    if (typeof input !== 'string') { from = input.from; dtoFields[field] = properties[field]!; continue; }
    const value = values[input];
    if (value === undefined && !(definition.input.required as readonly string[]).includes(field)) continue;
    if (typeof value !== 'string') throw new NaruError('NARU_ARGUMENT', `--${input} is required.`);
    if (properties[field]!.type === 'integer') {
      if (!/^\d+$/.test(value)) throw new NaruError('NARU_ARGUMENT', `--${input} must be a non-negative safe integer.`);
      request[field] = Number(value);
    } else request[field] = value;
  }
  if (from) {
    if (typeof values[from] !== 'string') throw new NaruError('NARU_ARGUMENT', `--${from} is required.`);
    const dto = await readJson(values[from] as string);
    validateInput({ type: 'object', properties: dtoFields, required: (definition.input.required as readonly string[]).filter(field => Object.hasOwn(dtoFields, field)), additionalProperties: false }, dto);
    Object.assign(request, dto);
  }
  return readOperation(request);
}
export function capabilities(name?: string) {
  if (!name) return { schemaVersion: 1, operations: Object.entries(operationDefinitions).map(([type, value]) => ({ type, description: value.description, advanced: !!('advanced' in value && value.advanced), command: operationBindings[type as OperationName].command })) };
  if (!Object.hasOwn(operationDefinitions, name)) throw new NaruError('NARU_ARGUMENT', 'Unknown operation; list capabilities first.');
  const key = name as OperationName, definition = operationDefinitions[key];
  return { schemaVersion: 1, operation: name, description: definition.description, input: operationSchema(key), example: { type: name, ...definition.example }, target: definition.target, effect: definition.effect, retry: definition.retry, cli: operationExample(key) };
}
export function commandHelp(positionals: string[] = []): string {
  const two = positionals.slice(0, 2).join(' '), one = positionals[0] ?? '';
  const command = Object.hasOwn(commands, two) ? two : Object.hasOwn(commands, one) ? one : undefined;
  if (!command) {
    const listed = Object.entries(commands).filter(([name]) => !one || name.startsWith(one + ' '));
    if (!listed.length) throw new NaruError('NARU_ARGUMENT', 'Unknown help topic; run narudoc --help.');
    return `NaruDoc — ${one || 'headless structured documents'}\n\n` + listed.map(([name, spec]) => `  narudoc ${name}${spec.file ? ' FILE' : ''} — ${spec.description}${spec.operation && 'advanced' in operationDefinitions[spec.operation] ? ' [advanced precision]' : ''}\n`).join('') + '\nUse narudoc COMMAND --help for options, index meaning, examples and failure recovery.\nUse capabilities --json to discover semantic operations. Reads accept - / --stdin.\nWrites support --dry-run, --revision SHA256 and --json. New/output files never overwrite.\nExit: 0 success; 1 internal; 2 arguments/target; 3 document; 4 conflict; 5 I/O.\nOffsets: UTF-16 [start,end).\n';
  }
  const spec = commands[command];
  let result = `narudoc ${command}${spec!.file ? ' FILE' : ''}\n${spec!.description}\n\nOptions:\n`;
  for (const [flag, opt] of Object.entries(spec!.options)) result += `  --${flag}${opt.type === 'boolean' ? '' : ' VALUE'} (${opt.required ? 'required' : 'optional'}) ${opt.description}${opt.schema?.enum ? ' Allowed: ' + opt.schema.enum.join(' | ') + '.' : ''}\n`;
  result += '  --json (optional) Machine-readable result.\n  --help (optional) Show this help without reading a document.\n\nExample:\n  ' + spec!.example + '\n';
  if (spec!.operation) {
    const example = operationExample(spec!.operation);
    if (Object.keys(example.json).length) result += 'input.json:\n' + JSON.stringify(example.json, null, 2) + '\n';
    result += '\nTarget: ' + operationDefinitions[spec!.operation].target + '\n' + operationDefinitions[spec!.operation].retry + '\n';
  }
  return result + '\nOn argument errors check this help. On document errors run validate; on target/stale errors re-query, adjust step-relative indices, then plan again.\n';
}
export function commandReference(): string {
  return '| Command | Options (`!` required) | Purpose |\n| --- | --- | --- |\n' + Object.entries(commands).map(([name, spec]) => `| \`${name}${spec.file ? ' FILE' : ''}\` | ${Object.entries(spec.options).map(([flag, opt]) => `\`--${flag}${opt.required ? ' !' : ''}\``).join(', ')} | ${spec.description} |`).join('\n');
}
