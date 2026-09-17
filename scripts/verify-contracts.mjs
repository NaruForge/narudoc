import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { commandReference, checkBindings, operationBindings } from '../apps/cli/dist/commands.js';
import { operationDefinitions, readOperation } from '../packages/model/dist/index.js';

export function checkGenerated(actual, expected) {
  if (actual !== expected) throw Error('CLI reference drift: run node scripts/verify-contracts.mjs --write after building.');
}
export async function verifyContracts(write = false) {
  checkBindings(operationDefinitions, operationBindings);
  for (const [type, definition] of Object.entries(operationDefinitions)) readOperation({ type, ...definition.example });
  const path = new URL('../docs/cli.md', import.meta.url), source = await readFile(path, 'utf8');
  const start = '<!-- generated:commands:start -->', end = '<!-- generated:commands:end -->';
  if (!source.includes(start) || !source.includes(end)) throw Error('Missing CLI reference markers.');
  const expected = source.slice(0, source.indexOf(start) + start.length) + '\n' + commandReference() + '\n' + source.slice(source.indexOf(end));
  if (write) await writeFile(path, expected); else checkGenerated(source, expected);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyContracts(process.argv.includes('--write')); console.log('PASS: operation bindings, examples and generated CLI reference');
}
