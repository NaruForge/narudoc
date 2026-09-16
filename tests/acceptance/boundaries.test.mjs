import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const deps = { model: [], parser: ['model'], core: ['model', 'parser'], 'renderer-html': ['model'] };
for (const [name, expected] of Object.entries(deps)) test(`headless package boundary: ${name}`, async () => {
  const dir = new URL(`packages/${name}/`, root);
  const pkg = JSON.parse(await readFile(new URL('package.json', dir), 'utf8'));
  assert.equal(pkg.version, '0.0.2');
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), expected.map(n => `@naruforge/narudoc-${n}`).sort());
  for (const file of await readdir(new URL('src/', dir))) {
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(new URL(`src/${file}`, dir), 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      const imported = match[1];
      if (!imported.startsWith('.')) assert.ok(Object.hasOwn(pkg.dependencies, imported), `${name}: undeclared import ${imported}`);
      assert.ok(!imported.includes('node:') && !/react|tiptap|prosemirror|apps\//i.test(imported));
    }
    assert.ok(!/\b(?:document|window|localStorage)\s*\./.test(source), `${name}: DOM access`);
    assert.ok(!/\bfetch\s*\(/.test(source), `${name}: network access`);
  }
});
test('workspace and CLI versions, binary entry and strict compiler contracts', async () => {
  for (const file of ['package.json', 'apps/cli/package.json']) assert.equal(JSON.parse(await readFile(new URL(file, root), 'utf8')).version, '0.0.2');
  const compiler = JSON.parse(await readFile(new URL('tsconfig.base.json', root), 'utf8'));
  assert.equal(compiler.compilerOptions.strict, true);
  assert.equal(compiler.compilerOptions.noUncheckedIndexedAccess, true);
  const entry = await readFile(new URL('apps/cli/bin/narudoc.mjs', root), 'utf8');
  assert.match(entry, /^#!\/usr\/bin\/env node/);
});
