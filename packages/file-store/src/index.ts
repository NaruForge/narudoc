export { parseJsonInput } from './json.js';
export { ASSET_LIMITS, resolveDocumentAssets, readDocumentAsset, sniffImage, type AssetDiagnostic, type AssetLimits, type AssetReport, type ResolvedAsset } from './asset.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink, link } from 'node:fs/promises';
import { dirname, basename, join, parse, resolve, sep } from 'node:path';
import { NaruError } from '@naruforge/narudoc-model';

const MAX_BYTES = 10 * 1024 * 1024;
export const revision = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
export function assertDocumentSize(source: string): void {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new NaruError('NARU_LIMIT', 'Document exceeds the 10 MiB MVP limit.');
}
export function decode(data: Uint8Array): string {
  if (data.byteLength > MAX_BYTES) throw new NaruError('NARU_LIMIT', 'Document exceeds the 10 MiB MVP limit.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
  catch { throw new NaruError('NARU_ENCODING', 'Input must be valid UTF-8.'); }
}
async function safePath(file: string): Promise<string> {
  const absolute = resolve(file), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep)) {
    if (!part) continue;
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new NaruError('NARU_IO', 'Symlink paths are not supported by the MVP file adapter.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}
export interface FileSnapshot { path: string; bytes: Buffer; source: string; revision: string; ino: number; dev: number; mode: number }
export async function load(file: string): Promise<FileSnapshot> {
  const path = await safePath(file), before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1) throw new NaruError('NARU_IO', 'Expected a regular, non-hardlinked file.');
  if (before.size > MAX_BYTES) throw new NaruError('NARU_LIMIT', 'Document exceeds the 10 MiB MVP limit.');
  const bytes = await readFile(path), after = await lstat(path);
  if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1 || after.size !== bytes.length || after.mtimeMs !== before.mtimeMs) throw new NaruError('NARU_STALE', 'File changed while being read.');
  return { path, bytes, source: decode(bytes), revision: revision(bytes), ino: before.ino, dev: before.dev, mode: before.mode };
}
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += buffer.length;
    if (length > MAX_BYTES) throw new NaruError('NARU_LIMIT', 'Input exceeds the 10 MiB MVP limit.');
    chunks.push(buffer);
  }
  return decode(Buffer.concat(chunks));
}
async function temporary(path: string, source: string, mode = 0o600): Promise<string> {
  const temp = join(dirname(path), `${basename(path)}.narudoc-tmp-${randomUUID()}`);
  const handle = await open(temp, 'wx', mode & 0o777);
  try { await handle.writeFile(source, 'utf8'); await handle.chmod(mode & 0o777); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temp).catch(() => {}); throw error; }
  await handle.close(); return temp;
}
export async function createFile(file: string, source: string): Promise<void> {
  const path = await safePath(file), temp = await temporary(path, source);
  try { await link(temp, path); } // Atomic no-clobber publication; never overwrite an existing target.
  finally { await unlink(temp); }
}
export async function save(snapshot: FileSnapshot, source: string): Promise<void> {
  assertDocumentSize(source);
  if (source === snapshot.source) {
    const current = await load(snapshot.path);
    if (current.revision !== snapshot.revision || current.ino !== snapshot.ino || current.dev !== snapshot.dev) throw new NaruError('NARU_STALE', 'File changed after it was inspected.');
    return;
  }
  const path = await safePath(snapshot.path), lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new NaruError('NARU_LOCKED', `Lock exists: ${lockPath}. Do not remove a live writer's lock.`);
    throw error;
  }
  let temp: string | undefined;
  const unchanged = async () => {
    const current = await load(path);
    if (current.revision !== snapshot.revision || current.ino !== snapshot.ino || current.dev !== snapshot.dev) throw new NaruError('NARU_STALE', 'File changed after it was inspected.');
  };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
    await unchanged();
    temp = await temporary(path, source, snapshot.mode);
    await unchanged();
    await rename(temp, path); temp = undefined;
  } finally {
    if (temp) await unlink(temp).catch(() => {});
    await lock.close(); await unlink(lockPath);
  }
}
