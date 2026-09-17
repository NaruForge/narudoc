import { startEditor, openBrowser } from '@naruforge/narudoc-web';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { BatchOperationError, NaruError, type TextEdit } from '@naruforge/narudoc-model';
import { assertValid, createDocument, getById, getSection, getTable, outline, parseDocument, planBatch, planOperation, validateDocument } from '@naruforge/narudoc-core';
import { renderHtml } from '@naruforge/narudoc-renderer-html';
import { assertDocumentSize, createFile, load, readStdin, revision, save } from './io.js';
import { parseJsonInput } from './json.js';

import { commands, parseOptions, bindOperation, capabilities, commandHelp } from './commands.js';

function exitCode(error: NaruError): number {
  if (['NARU_ARGUMENT', 'NARU_TARGET'].includes(error.code)) return 2;
  if (['NARU_INVALID_DOCUMENT', 'NARU_ENCODING'].includes(error.code)) return 3;
  if (['NARU_STALE', 'NARU_LOCKED'].includes(error.code)) return 4;
  if (['NARU_IO', 'NARU_LIMIT'].includes(error.code)) return 5;
  return 1;
}
function preview(edits: TextEdit[]): string {
  if (!edits.length) return 'No changes.\n';
  return edits.map(e => `@@ UTF-16 ${e.start}:${e.end} @@\n- ${JSON.stringify(e.expected)}\n+ ${JSON.stringify(e.text)}\n`).join('');
}
export async function main(args: string[]): Promise<number> {
  const json = args.includes('--json');
  const emit = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  try {
    const { values, positionals, tokens } = parseArgs({ args, options: parseOptions, allowPositionals: true, strict: true, tokens: true });
    const seen = new Set<string>();
    for (const token of tokens) if (token.kind === 'option') {
      if (seen.has(token.name)) throw new NaruError('NARU_ARGUMENT', `Repeated option: --${token.name}`);
      seen.add(token.name);
    }
    if (values.help || !args.length) { process.stdout.write(commandHelp(positionals)); return 0; }
    if (values.version) {
      const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
      if (json) emit({ version: pkg.version }); else process.stdout.write(`${pkg.version}\n`);
      return 0;
    }
    const positions = [...positionals];
    let command = positions.shift() ?? '';
    if (Object.keys(commands).some(name => name.startsWith(command + ' '))) command += ' ' + (positions.shift() ?? '');
    const allowed = commands[command];
    if (!allowed) throw new NaruError('NARU_ARGUMENT', 'Unknown command; run narudoc --help.');
    for (const key of Object.keys(values)) if (!['json', ...Object.keys(allowed.options)].includes(key)) throw new NaruError('NARU_ARGUMENT', `--${key} is not valid for ${command}.`);
    if (command === 'capabilities') {
      if (positions.length) throw new NaruError('NARU_ARGUMENT', 'capabilities does not read a file.');
      emit(capabilities(typeof values.operation === 'string' ? values.operation : undefined)); return 0;
    }
    if (positions.length > 1 || (values.stdin && positions.length)) throw new NaruError('NARU_ARGUMENT', 'Supply exactly one file or --stdin.');
    const file = values.stdin ? '-' : positions[0];
    if (!file) throw new NaruError('NARU_ARGUMENT', 'A file is required.');
    const need = (key: keyof typeof values): string => {
      const value = values[key];
      if (typeof value !== 'string') throw new NaruError('NARU_ARGUMENT', `--${key} is required.`);
      return value;
    };
    const integer = (key: keyof typeof values): number => {
      const value = need(key);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new NaruError('NARU_ARGUMENT', `--${key} must be a non-negative safe integer.`);
      return Number(value);
    };
    if (command === 'edit') {
      if (file === '-') throw new NaruError('NARU_ARGUMENT', 'edit requires a local file.');
      const port = values.port === undefined ? 0 : integer('port');
      if (port > 65535) throw new NaruError('NARU_ARGUMENT', 'Port must be 0 to 65535.');
      const editor = await startEditor(file, port);
      if (json) emit({ url: editor.url }); else process.stdout.write('NaruDoc local editor: ' + editor.url + '\nKeep this process running. Ctrl+C to stop.\n');
      if (!values['no-open']) openBrowser(editor.url);
      return 0;
    }
    const write = command === 'new' || command === 'batch' || (command.includes(' ') && command !== 'table get');
    if (write && file === '-') throw new NaruError('NARU_ARGUMENT', 'In-place writes require a file, not stdin.');
    if (command === 'batch') {
      need('operations');
      if (!/^[0-9a-f]{64}$/.test(need('revision'))) throw new NaruError('NARU_ARGUMENT', '--revision must be a lowercase SHA-256 for batch.');
    }
    if (command === 'new') {
      const doc = createDocument(typeof values.title === 'string' ? values.title : undefined, typeof values.id === 'string' ? values.id : undefined);
      assertDocumentSize(doc.source);
      await createFile(file, doc.source);
      if (json) emit({ schemaVersion: 1, file, revision: revision(doc.source) }); else process.stdout.write(`Created ${file}\n`);
      return 0;
    }
    const loaded = file === '-' ? undefined : await load(file);
    const source = loaded?.source ?? await readStdin();
    const doc = parseDocument(source), rev = loaded?.revision ?? revision(source);
    const envelope = { schemaVersion: 1, file, revision: rev, offsetEncoding: 'utf-16' };
    if (values.revision && values.revision !== rev) throw new NaruError('NARU_STALE', 'Requested revision does not match the current file.');
    switch (command) {
      case 'table get': {
        const node = getTable(doc, need('section'), integer('index'));
        const text = source.slice(node.range.start, node.range.end);
        if (json) emit({ ...envelope, node, source: text }); else process.stdout.write(text);
        return 0;
      }
      case 'batch': {
        const input = need('operations');
        const text = input === '-' ? await readStdin() : (await load(input)).source;
        const request = parseJsonInput(text);
        const plan = planBatch(doc, request);
        assertDocumentSize(plan.next.source);
        const changed = plan.next.source !== source;
        if (!values['dry-run']) await save(loaded!, plan.next.source);
        if (json) emit({ ...envelope, dryRun: !!values['dry-run'], changed, nextRevision: revision(plan.next.source), steps: plan.steps, diagnostics: validateDocument(plan.next) });
        else if (values['dry-run']) process.stdout.write(plan.steps.map(step => `Operation ${step.operationIndex} (offsets in this step's input):\n${preview(step.edits)}`).join(''));
        else process.stdout.write(changed ? `Updated ${file}\n` : 'No changes.\n');
        return 0;
      }
      case 'inspect': emit({ ...envelope, sourceLength: source.length, blocks: doc.blocks, diagnostics: validateDocument(doc) }); return 0;
      case 'outline':
        if (json) emit({ ...envelope, sections: outline(doc) });
        else process.stdout.write(outline(doc).map(s => `${'  '.repeat(s.level - 1)}${s.title}${s.id ? ` {#${s.id}}` : ''}\n`).join(''));
        return 0;
      case 'get': {
        const node = getById(doc, need('id'));
        const range = node.type === 'heading' ? getSection(doc, need('id')) : node.range;
        const text = source.slice(range.start, range.end);
        if (json) emit({ ...envelope, node, source: text }); else process.stdout.write(text);
        return 0;
      }
      case 'validate': {
        const diagnostics = validateDocument(doc), valid = !diagnostics.some(d => d.severity === 'error');
        if (json) emit({ ...envelope, valid, diagnostics }); else {
          for (const d of diagnostics) process.stderr.write(`${file}:${d.range.start} ${d.code}: ${d.message}\n`);
          if (valid) process.stdout.write(`Valid: ${file}\n`);
        }
        return valid ? 0 : 3;
      }
      case 'render': {
        if (need('to') !== 'html') throw new NaruError('NARU_ARGUMENT', 'Only --to html is supported.');
        assertValid(doc); const html = renderHtml(doc);
        if (values.output) {
          await createFile(need('output'), html);
          if (json) emit({ ...envelope, output: values.output }); else process.stdout.write(`Rendered ${values.output}\n`);
        } else if (json) emit({ ...envelope, html }); else process.stdout.write(html);
        return 0;
      }
    }
    const operation = await bindOperation(command, values, async input => parseJsonInput(input === '-' ? await readStdin() : (await load(input)).source));
    const plan = planOperation(doc, operation);
    assertDocumentSize(plan.next.source);
    if (!values['dry-run']) await save(loaded!, plan.next.source);
    if (json) emit({ ...envelope, dryRun: !!values['dry-run'], changed: plan.edits.length > 0, nextRevision: revision(plan.next.source), edits: plan.edits, diagnostics: validateDocument(plan.next) });
    else if (values['dry-run']) process.stdout.write(preview(plan.edits));
    else process.stdout.write(plan.edits.length ? `Updated ${file}\n` : 'No changes.\n');
    return 0;
  } catch (error) {
    const original = error as Error & { code?: string };
    const classified = error instanceof NaruError ? error : new NaruError(original.code?.startsWith('ERR_PARSE_ARGS') ? 'NARU_ARGUMENT' : original.code ? 'NARU_IO' : 'NARU_INTERNAL', original.message);
    if (json) process.stderr.write(JSON.stringify({ schemaVersion: 1, error: { code: classified.code, message: classified.message, diagnostics: classified.diagnostics, ...(classified instanceof BatchOperationError ? { operationIndex: classified.operationIndex } : {}) } }) + '\n');
    else process.stderr.write(`${classified.code}: ${classified.message}\n${classified.diagnostics.map(d => `${d.range.start} ${d.code}: ${d.message}\n`).join('')}`);
    return exitCode(classified);
  }
}
