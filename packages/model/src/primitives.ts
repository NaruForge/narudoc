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
