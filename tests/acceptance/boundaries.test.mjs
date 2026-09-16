import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArchitecture } from '../../scripts/verify-architecture.mjs';
import { verifyGuide, verifyPractice } from '../../scripts/verify-guide.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('all workspace packages, recursive source and actual guide links/map pass', async () => {
  assert.equal((await verifyArchitecture(root)).packages.length, 8);
  assert.ok((await verifyGuide(root)).links > 0);
  const compiler = JSON.parse(await readFile(join(root, 'tsconfig.base.json'), 'utf8'));
  assert.equal(compiler.compilerOptions.strict, true);
  assert.equal(compiler.compilerOptions.noUncheckedIndexedAccess, true);
  assert.match(await readFile(join(root, 'apps/cli/bin/narudoc.mjs'), 'utf8'), /^#!\/usr\/bin\/env node/);
});
test('README practice executes actual documented argv with independent expected bytes', async () => {
  assert.deepEqual(await verifyPractice(root), { commands: 8, exactBytes: true, dryRunUnchanged: true });
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'naru-boundary-')); t.after(() => rm(dir, { recursive: true, force: true }));
  // Copy source/contracts only. Never mutate a shared checkout or dist while tests run.
  for (const path of ['apps', 'packages', 'docs', 'examples', 'tests', 'scripts', '.agents', '.github', 'AGENTS.md', 'README.md', 'package.json', 'pnpm-workspace.yaml']) {
    await cp(join(root, path), join(dir, path), { recursive: true, filter: src => !/[\\/](?:node_modules|dist)(?:[\\/]|$)/.test(src) });
  }
  return dir;
}
test('architecture mutations fail for nested globals, dynamic Node import, deep import, backedge, cycles and new packages', async t => {
  const dir = await fixture(t), nested = join(dir, 'packages/core/src/nested'); await mkdir(nested);
  const bad = join(nested, 'regression.ts');
  for (const [source, error] of [
    ['globalThis["fetch"]("https://invalid.test");', /headless global/],
    ['import("node:fs");', /Node dependency/],
    ['import { x } from "@naruforge/narudoc-model/dist/index.js";', /nonpublic deep import/],
    ['import { x } from "../../../../apps/cli/src/index.js";', /cross-package/],
    ['import(name);', /nonliteral/],
    ['import "./loop.js";', /Runtime source cycle/],
  ]) {
    await writeFile(join(nested, 'loop.ts'), 'import "./regression.js";');
    await writeFile(bad, source); await assert.rejects(verifyArchitecture(dir), error, source);
  }
  await rm(nested, { recursive: true });
  const typeA = join(dir, 'packages/model/src/type-a.ts'), typeB = join(dir, 'packages/model/src/type-b.ts');
  await writeFile(typeA, 'export interface A {}\nexport { type B } from "./type-b.js";');
  await writeFile(typeB, 'export interface B {}\nexport { type A } from "./type-a.js";');
  await verifyArchitecture(dir); // Explicit type-only re-export cycles have no runtime edge.
  await rm(typeA); await rm(typeB);
  const modelFile = join(dir, 'packages/model/package.json'), model = JSON.parse(await readFile(modelFile, 'utf8'));
  await writeFile(modelFile, JSON.stringify({ ...model, dependencies: { '@naruforge/narudoc': 'workspace:*' } }));
  await assert.rejects(verifyArchitecture(dir), /forbidden dependency/);
  await writeFile(modelFile, JSON.stringify(model));
  const cli = join(dir, 'apps/cli/src/extra.ts'); await writeFile(cli, 'import { startEditor } from "@naruforge/narudoc-web";');
  await assert.rejects(verifyArchitecture(dir), /launcher exception/); await rm(cli);
  const session = join(dir, 'packages/editor-adapter/src/session.ts'), originalSession = await readFile(session, 'utf8');
  const helper = join(dir, 'packages/editor-adapter/src/helper.ts');
  await writeFile(helper, 'import { EditorState } from "prosemirror-state"; export const state = EditorState;');
  await writeFile(session, originalSession + '\nimport "./helper.js";');
  await assert.rejects(verifyArchitecture(dir), /impure session dependency/);
  await writeFile(session, originalSession); await rm(helper);
  await mkdir(join(dir, 'packages/unmapped'));
  await writeFile(join(dir, 'packages/unmapped/package.json'), JSON.stringify({ name: '@naruforge/new', version: '0.0.3' }));
  await assert.rejects(verifyArchitecture(dir), /Unmapped workspace/);
});
test('broken local links, anchors, missing map coverage and README command drift fail', async t => {
  const dir = await fixture(t), readmeFile = join(dir, 'README.md'), readme = await readFile(readmeFile, 'utf8');
  await writeFile(readmeFile, readme + '\n[missing](docs/missing.md)\n'); await assert.rejects(verifyGuide(dir), /broken link/);
  await writeFile(readmeFile, readme + '\n[missing](docs/cli.md#absent-heading)\n'); await assert.rejects(verifyGuide(dir), /missing anchor/);
  await writeFile(readmeFile, readme);
  const mapFile = join(dir, 'docs/repository-structure.md'), map = await readFile(mapFile, 'utf8');
  await writeFile(mapFile, map.replace('[packages/model](../packages/model/)', 'model'));
  await assert.rejects(verifyGuide(dir), /map lacks package link/);
  await writeFile(mapFile, map);
  // Link checks cannot certify commands. Execute a mutated README against real built CLI separately.
  const commandRoot = await mkdtemp(join(tmpdir(), 'naru-guide-drift-')); t.after(() => rm(commandRoot, { recursive: true, force: true }));
  await mkdir(join(commandRoot, 'apps/cli/bin'), { recursive: true });
  await writeFile(join(commandRoot, 'README.md'), readme.replace('--text "Voltage is 400 V." --dry-run', '--not-an-option "Voltage is 400 V." --dry-run'));
  await writeFile(join(commandRoot, 'apps/cli/bin/narudoc.mjs'), `import { main } from ${JSON.stringify(new URL('../../apps/cli/dist/index.js', import.meta.url).href)}; process.exitCode = await main(process.argv.slice(2));`);
  await assert.rejects(verifyPractice(commandRoot), /not-an-option/);
});
