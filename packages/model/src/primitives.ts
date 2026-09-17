import type { Diagnostic } from './index.js';

export class NaruError extends Error {
  constructor(public readonly code: string, message: string, public readonly diagnostics: Diagnostic[] = []) {
    super(message); this.name = 'NaruError';
  }
}
export class BatchOperationError extends NaruError {
  constructor(public readonly operationIndex: number, cause: NaruError) {
    super(cause.code, `Operation ${operationIndex}: ${cause.message}`, cause.diagnostics);
    this.name = 'BatchOperationError';
  }
}
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function validKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key);
}
export function boundary(source: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  const a = source.charCodeAt(offset - 1), b = source.charCodeAt(offset);
  return !(a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff);
}
export function wellFormed(source: string): boolean {
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
/** Extensions a figure asset may declare; the host resolver also sniffs the actual bytes. */
export const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
/**
 * Portable document-relative asset path rules shared by Core input validation and host resolvers.
 * Sources store `/`-separated relative paths only; returns a rejection reason or undefined.
 */
export function assetPathProblem(src: string): string | undefined {
  if (typeof src !== 'string' || !wellFormed(src) || /[\x00-\x1f\x7f\\]/.test(src) || src !== src.trim() || !src)
    return 'Asset path must be a nonempty trimmed single-line Unicode string without control characters or backslashes.';
  if (src.startsWith('/') || /^[A-Za-z]:/.test(src)) return 'Asset path must be relative to the document folder, not absolute or drive-qualified.';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(src)) return 'Asset path must not carry a URL scheme.';
  const segments = src.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return 'Asset path must not contain empty, dot, or dot-dot segments.';
  const name = segments.at(-1)!.toLowerCase();
  if (!ASSET_EXTENSIONS.some(extension => name.endsWith(extension))) return `Asset extension must be one of ${ASSET_EXTENSIONS.join(' ')}.`;
  return undefined;
}
