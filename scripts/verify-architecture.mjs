import { readFile, readdir, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const prefix = '@naruforge/narudoc';
const rules = {
  'packages/model': { engine: true, deps: [] },
  'packages/parser': { engine: true, deps: ['model'] },
  'packages/core': { engine: true, deps: ['model', 'parser'] },
  'packages/renderer-html': { engine: true, deps: ['model'] },
  'packages/file-store': { deps: ['model'] },
  'packages/editor-adapter': { deps: ['model', 'core', 'renderer-html'], external: ['prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-history'] },
  'apps/web': { deps: ['model', 'core', 'renderer-html', 'file-store', 'editor-adapter'] },
  // The only app-to-app exception: CLI edit launcher imports these two public exports.
  'apps/cli': { deps: ['model', 'core', 'renderer-html', 'file-store', 'web'] },
};
const slash = value => value.split(sep).join('/');
const inside = (parent, path) => path === parent || path.startsWith(parent + sep);
async function exists(path) { try { return await stat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source symlink requires review: ${path}`);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) result.push(path);
  }
  return result;
}
export async function workspacePackages(root) {
  const yaml = await readFile(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map(match => match[1]);
  if (!patterns.length) throw new Error('No workspace patterns');
  const packages = [];
  for (const pattern of patterns) {
    // Fail closed on a new glob dialect instead of silently leaving packages uninspected.
    if (!/^[\w-]+\/\*$/.test(pattern)) throw new Error(`Review workspace discovery for pattern ${pattern}`);
    const parent = pattern.slice(0, -2);
    for (const entry of await readdir(resolve(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = `${parent}/${entry.name}`, file = resolve(root, path, 'package.json');
      if (await exists(file)) packages.push({ path, dir: resolve(root, path), ...JSON.parse(await readFile(file, 'utf8')) });
    }
  }
  if (new Set(packages.map(pkg => pkg.name)).size !== packages.length) throw new Error('Duplicate workspace package');
  return packages;
}
function cycle(graph, label) {
  const complete = new Set(), active = [];
  function visit(node) {
    if (active.includes(node)) throw new Error(`${label} cycle: ${[...active.slice(active.indexOf(node)), node].join(' -> ')}`);
    if (complete.has(node)) return;
    active.push(node); for (const next of graph.get(node) ?? []) visit(next); active.pop(); complete.add(node);
  }
  for (const node of graph.keys()) visit(node);
}
function imports(source, file, pure) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), result = [];
  const globals = new Set(['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', 'process', 'Buffer', 'require']);
  const runtime = node => {
    if (ts.isImportDeclaration(node)) return !node.importClause?.isTypeOnly && (!node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings) || !!node.importClause.name || node.importClause.namedBindings.elements.some(e => !e.isTypeOnly));
    if (ts.isExportDeclaration(node)) return !node.isTypeOnly && (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(e => !e.isTypeOnly));
    return !node.isTypeOnly;
  };
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      result.push({ spec: node.moduleSpecifier.text, runtime: runtime(node), node });
      return; // Imports are checked separately; do not mistake names for global access.
    }
    if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) result.push({ spec: node.argument.literal.text, runtime: false, node });
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error(`${file}: nonliteral module loading requires review`);
      result.push({ spec: node.arguments[0].text, runtime: true, node });
    }
    // Check executable globals, including globalThis['fetch']; skip type positions and property keys.
    if (pure && ts.isIdentifier(node) && globals.has(node.text)) {
      const parent = node.parent;
      const key = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent)) && parent.name === node;
      if (!key && !(ts.isPropertyAccessExpression(parent) && parent.name === node && parent.expression.getText(ast) !== 'globalThis')) throw new Error(`${file}: headless global ${node.text}`);
    }
    if (pure && ts.isElementAccessExpression(node) && node.expression.getText(ast) === 'globalThis' && (!ts.isStringLiteral(node.argumentExpression) || globals.has(node.argumentExpression.text))) throw new Error(`${file}: headless global access`);
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, visit);
  }
  visit(ast); return result;
}
export async function verifyArchitecture(root = fileURLToPath(new URL('../', import.meta.url))) {
  root = resolve(root);
  const packages = await workspacePackages(root), byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const packageGraph = new Map(), sourceGraph = new Map(), sources = new Map();
  const rootVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  for (const pkg of packages) {
    const rule = rules[pkg.path]; if (!rule) throw new Error(`Unmapped workspace package ${pkg.path}`);
    if (pkg.version !== rootVersion) throw new Error(`Version drift: ${pkg.path}`);
    const allowed = [...rule.deps.map(dep => `${prefix}-${dep}`), ...(rule.external ?? [])];
    for (const dependency of Object.keys(pkg.dependencies ?? {})) if (!allowed.includes(dependency)) throw new Error(`${pkg.path}: forbidden dependency ${dependency}`);
    packageGraph.set(pkg.name, Object.keys(pkg.dependencies ?? {}).filter(name => byName.has(name)));
  }
  cycle(packageGraph, 'Package');
  const units = [...packages, { path: 'apps/editor-spike', dir: resolve(root, 'apps/editor-spike'), name: 'spike-harness', dependencies: { [`${prefix}-editor-adapter`]: 'workspace:*' } }];
  let files = 0;
  for (const pkg of units) {
    if (!await exists(pkg.dir)) continue;
    for (const file of await walk(pkg.dir)) {
      files++;
      const local = slash(relative(root, file));
      const pure = !!rules[pkg.path]?.engine || local === 'packages/editor-adapter/src/session.ts';
      const edges = [], source = await readFile(file, 'utf8'); sources.set(file, { source, local });
      for (const item of imports(source, local, pure)) {
        const { spec } = item;
        if (spec.startsWith('.')) {
          let target = resolve(dirname(file), spec);
          if (!inside(pkg.dir, target)) {
            if (pkg.name === 'spike-harness' && local === 'apps/editor-spike/app.mjs' && spec === '../../examples/visual-fidelity.narudoc') continue;
            throw new Error(`${local}: cross-package relative/deep import ${spec}`);
          }
          if (spec.endsWith('.js') && await exists(target.slice(0, -3) + '.ts')) target = target.slice(0, -3) + '.ts';
          if (!await exists(target) && !(local === 'apps/cli/bin/narudoc.mjs' && spec === '../dist/index.js')) throw new Error(`${local}: unresolved import ${spec}`);
          if (item.runtime) edges.push(target);
          continue;
        }
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (spec.startsWith('node:') || builtinModules.includes(spec)) {
          if (pure || pkg.path === 'packages/editor-adapter' || local.startsWith('apps/web/public/')) throw new Error(`${local}: Node dependency ${spec}`);
          continue;
        }
        if (!Object.hasOwn(pkg.dependencies ?? {}, name)) throw new Error(`${local}: undeclared dependency ${spec}`);
        if (pure && !rules[pkg.path]?.engine && ![`${prefix}-model`, `${prefix}-core`].includes(name)) throw new Error(`${local}: impure session dependency ${spec}`);
        const dependency = byName.get(name);
        if (dependency) {
          const subpath = '.' + spec.slice(name.length);
          if (!Object.hasOwn(dependency.exports ?? {}, subpath)) throw new Error(`${local}: nonpublic deep import ${spec}`);
          if (pkg.path.startsWith('packages/') && dependency.path.startsWith('apps/')) throw new Error(`${local}: library-to-app dependency`);
          if (pkg.path === 'apps/cli' && dependency.path === 'apps/web') {
            const bindings = item.node.importClause?.namedBindings;
            if (local !== 'apps/cli/src/index.ts' || !bindings || !ts.isNamedImports(bindings) || bindings.elements.some(e => !['startEditor', 'openBrowser'].includes((e.propertyName ?? e.name).text))) throw new Error(`${local}: CLI/web launcher exception exceeded`);
          }
        }
      }
      sourceGraph.set(file, edges);
    }
  }
  cycle(sourceGraph, 'Runtime source');
  const checked = new Set();
  function pureSession(file) {
    if (checked.has(file)) return; checked.add(file);
    const unit = sources.get(file); if (!unit) return;
    for (const item of imports(unit.source, unit.local, true)) {
      if (!item.spec.startsWith('.') && ![`${prefix}-model`, `${prefix}-core`].includes(item.spec)) throw new Error(`${unit.local}: impure session dependency ${item.spec}`);
    }
    for (const next of sourceGraph.get(file) ?? []) pureSession(next);
  }
  pureSession(resolve(root, 'packages/editor-adapter/src/session.ts'));
  return { packages: packages.map(pkg => pkg.path).sort(), files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('PASS:', await verifyArchitecture());
