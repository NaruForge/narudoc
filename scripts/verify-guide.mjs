import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { workspacePackages } from './verify-architecture.mjs';

const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const slug = value => value.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/ /g, '-');
function prose(text) { return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, ''); }
function anchors(text) {
  const counts = new Map(), result = new Set();
  for (const match of prose(text).matchAll(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm)) {
    const key = slug(match[1]), count = counts.get(key) ?? 0;
    result.add(key + (count ? `-${count}` : '')); counts.set(key, count + 1);
  }
  return result;
}
async function markdownFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await markdownFiles(resolve(dir, entry.name)));
    else if (entry.name.endsWith('.md')) files.push(resolve(dir, entry.name));
  }
  return files;
}
export function practiceCommands(readme) {
  const region = readme.split('<!-- practice:start -->')[1]?.split('<!-- practice:end -->')[0];
  const block = region?.match(/```sh\r?\n([\s\S]*?)```/);
  if (!block) throw new Error('Missing executable README practice');
  return block[1].trim().split(/\r?\n/).map(line => {
    // Finite published argv grammar, never shell execution.
    if (!/^pnpm exec narudoc /.test(line) || /[;&|`$<>]/.test(line)) throw new Error(`Unsupported practice command: ${line}`);
    const tail = line.slice('pnpm exec narudoc '.length), matches = [...tail.matchAll(/"(?:[^"\\]|\\.)*"|[^\s"]+/g)];
    if (matches.map(match => match[0]).join(' ') !== tail) throw new Error(`Unsupported practice quoting: ${line}`);
    const args = matches.map(match => match[0].startsWith('"') ? JSON.parse(match[0]) : match[0]);
    const width = args[0] === 'paragraph' ? 2 : 1, command = args.slice(0, width).join(' ');
    if (!['new', 'paragraph insert', 'paragraph replace', 'get', 'validate', 'render'].includes(command) || args[width] !== 'practice.narudoc') throw new Error(`Practice must address only its isolated document: ${line}`);
    const output = args.indexOf('--output');
    if (output >= 0 && args[output + 1] !== 'practice.html') throw new Error(`Practice output must stay isolated: ${line}`);
    return args;
  });
}
export async function verifyGuide(root = rootDefault) {
  root = resolve(root);
  const files = [resolve(root, 'README.md'), resolve(root, 'AGENTS.md'), ...await markdownFiles(resolve(root, 'docs'))];
  let links = 0;
  for (const file of files) {
    const text = prose(await readFile(file, 'utf8')).replace(/(`+)[^\n]*?\1/g, '');
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1]; if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) continue;
      const [path, fragment] = href.split('#'), target = resolve(dirname(file), decodeURIComponent(path || relative(dirname(file), file)));
      if (!(target === root || target.startsWith(root + sep))) throw new Error(`${relative(root, file)}: link escapes repository ${href}`);
      let info; try { info = await stat(target); } catch { throw new Error(`${relative(root, file)}: broken link ${href}`); }
      if (fragment && info.isFile() && target.endsWith('.md') && !anchors(await readFile(target, 'utf8')).has(decodeURIComponent(fragment))) throw new Error(`${relative(root, file)}: missing anchor ${href}`);
      links++;
    }
  }
  const map = await readFile(resolve(root, 'docs/repository-structure.md'), 'utf8');
  for (const pkg of await workspacePackages(root)) if (!map.includes(`](../${pkg.path}/)`)) throw new Error(`Repository map lacks package link ${pkg.path}`);
  const commands = practiceCommands(await readFile(resolve(root, 'README.md'), 'utf8'));
  return { files: files.length, links, commands: commands.length };
}
export async function verifyPractice(root = rootDefault) {
  const commands = practiceCommands(await readFile(resolve(root, 'README.md'), 'utf8'));
  const cwd = await mkdtemp(join(tmpdir(), 'narudoc-readme-'));
  try {
    const file = join(cwd, 'practice.narudoc');
    for (const args of commands) {
      const before = args.includes('--dry-run') ? await readFile(file) : null;
      const result = spawnSync(process.execPath, [resolve(root, 'apps/cli/bin/narudoc.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.error?.message}`);
      if (before) assert.deepEqual(await readFile(file), before, 'README dry-run changed source');
    }
    assert.deepEqual(await readFile(file), Buffer.from('# Control {#control}\n\nVoltage is 420 V.\n'));
    assert.match(await readFile(join(cwd, 'practice.html'), 'utf8'), /Voltage is 420 V\./);
    return { commands: commands.length, exactBytes: true, dryRunUnchanged: true };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('PASS: guide links/map', await verifyGuide());
  console.log('PASS: README argv through CLI in isolated directory', await verifyPractice());
}
