import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { assetPathProblem, NaruError, type Diagnostic, type DocumentSnapshot } from '@naruforge/narudoc-model';

/** v1 asset limits: bound memory of one local editor session; unrelated to the 10 MiB document limit. */
export const ASSET_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxCount: 100,
  maxDimension: 16384,
} as const;
export type AssetLimits = { -readonly [K in keyof typeof ASSET_LIMITS]: number };
export interface AssetDiagnostic extends Diagnostic { src: string }
export interface ResolvedAsset { src: string; path: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number; width: number; height: number }
export interface AssetReport { assets: ReadonlyMap<string, ResolvedAsset>; diagnostics: AssetDiagnostic[] }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXTENSION_TYPE: Record<string, ResolvedAsset['mediaType']> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Magic bytes plus minimal container structure and pixel dimensions; not a full codec validation. */
export function sniffImage(bytes: Buffer): { mediaType: ResolvedAsset['mediaType']; width: number; height: number } | undefined {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
    if (bytes.readUInt32BE(bytes.length - 12) !== 0 || bytes.toString('latin1', bytes.length - 8, bytes.length - 4) !== 'IEND') return undefined;
    return { mediaType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 6 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return undefined;
    let offset = 2;
    while (offset + 3 < bytes.length - 1) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return undefined;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 7) return undefined;
        return { mediaType: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    return undefined;
  }
  if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) return { mediaType: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return { mediaType: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { mediaType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return undefined;
  }
  return undefined;
}

interface Stat { file: boolean; link: boolean; nlink: number; size: number; ino: number; dev: number; mtimeMs: number }
async function statOf(path: string): Promise<Stat | undefined> {
  try {
    const stat = await lstat(path);
    return { file: stat.isFile(), link: stat.isSymbolicLink(), nlink: stat.nlink, size: stat.size, ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
/** Walks every segment from the document folder; rejects links before the target is ever opened. */
async function resolveInside(root: string, src: string): Promise<{ path: string; stat: Stat }> {
  let current = root;
  const segments = src.split('/');
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const stat = await statOf(current);
    if (!stat) throw new NaruError('NARU_ASSET_MISSING', `Asset not found: ${src}`);
    if (stat.link) throw new NaruError('NARU_ASSET_LINK', `Asset path crosses a symlink or junction: ${src}`);
    if (index < segments.length - 1 && stat.file) throw new NaruError('NARU_ASSET_PATH', `Asset path crosses a regular file: ${src}`);
    if (index === segments.length - 1) {
      if (!stat.file) throw new NaruError('NARU_ASSET_PATH', `Asset must be a regular file: ${src}`);
      if (stat.nlink !== 1) throw new NaruError('NARU_ASSET_LINK', `Hardlinked assets are not supported: ${src}`);
      return { path: current, stat };
    }
  }
  throw new NaruError('NARU_ASSET_PATH', `Invalid asset path: ${src}`);
}
function sameStat(a: Stat, b: Stat): boolean {
  return a.file && b.file && a.ino === b.ino && a.dev === b.dev && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
/** Resolves, reads and validates one asset; re-stats after reading. Not a race-free filesystem sandbox. */
async function inspect(root: string, src: string, limits: AssetLimits): Promise<{ asset: ResolvedAsset; bytes: Buffer }> {
  const problem = assetPathProblem(src);
  if (problem) throw new NaruError('NARU_ASSET_PATH', problem);
  const { path, stat: before } = await resolveInside(root, src);
  const absolute = resolve(path);
  if (absolute !== path || !absolute.startsWith(resolve(root) + sep)) throw new NaruError('NARU_ASSET_PATH', `Asset escapes the document folder: ${src}`);
  if (before.size > limits.maxBytes) throw new NaruError('NARU_ASSET_LIMIT', `Asset exceeds the ${limits.maxBytes} byte per-file limit: ${src}`);
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (error) { throw new NaruError('NARU_ASSET_IO', `Asset is not readable: ${src} (${(error as NodeJS.ErrnoException).code ?? 'error'})`); }
  const after = await statOf(path);
  if (!after || !sameStat(before, after)) throw new NaruError('NARU_ASSET_IO', `Asset changed while being read: ${src}`);
  const image = sniffImage(bytes);
  if (!image) throw new NaruError('NARU_ASSET_TYPE', `Asset content is not a complete PNG, JPEG or WebP image: ${src}`);
  const extension = `.${src.split('/').at(-1)!.split('.').at(-1)!.toLowerCase()}`;
  if (EXTENSION_TYPE[extension] !== image.mediaType) throw new NaruError('NARU_ASSET_TYPE', `Asset extension ${extension} does not match its ${image.mediaType} content: ${src}`);
  if (image.width > limits.maxDimension || image.height > limits.maxDimension || image.width < 1 || image.height < 1)
    throw new NaruError('NARU_ASSET_LIMIT', `Asset dimensions exceed ${limits.maxDimension}px: ${src}`);
  return { asset: { src, path, mediaType: image.mediaType, bytes: bytes.length, width: image.width, height: image.height }, bytes };
}

/** Validates every figure asset of a parsed document without writing anything. */
export async function resolveDocumentAssets(documentPath: string, snapshot: DocumentSnapshot, limits: AssetLimits = { ...ASSET_LIMITS }): Promise<AssetReport> {
  const root = dirname(resolve(documentPath));
  const figures = snapshot.blocks.filter(block => block.type === 'figure');
  const assets = new Map<string, ResolvedAsset>(), diagnostics: AssetDiagnostic[] = [];
  let total = 0, index = 0;
  for (const figure of figures) {
    const report = (code: string, message: string): void => { diagnostics.push({ code, message, src: figure.src, severity: 'error', range: figure.range }); };
    if (index++ >= limits.maxCount) { report('NARU_ASSET_LIMIT', `Document exceeds the ${limits.maxCount} figure limit.`); continue; }
    if (assets.has(figure.src)) continue;
    try {
      const { asset } = await inspect(root, figure.src, limits);
      total += asset.bytes;
      if (total > limits.maxTotalBytes) { report('NARU_ASSET_LIMIT', `Assets exceed the ${limits.maxTotalBytes} byte document total.`); continue; }
      assets.set(figure.src, asset);
    } catch (error) {
      if (error instanceof NaruError) report(error.code, error.message);
      else throw error;
    }
  }
  return { assets, diagnostics };
}
/** Reads one validated asset for serving; the caller restricts src to the current document's figures. */
export async function readDocumentAsset(documentPath: string, src: string): Promise<{ bytes: Buffer; mediaType: ResolvedAsset['mediaType'] }> {
  const root = dirname(resolve(documentPath));
  const { asset, bytes } = await inspect(root, src, { ...ASSET_LIMITS });
  return { bytes, mediaType: asset.mediaType };
}
