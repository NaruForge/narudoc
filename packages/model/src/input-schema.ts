import { NaruError, wellFormed } from './primitives.js';

/** The finite JSON input vocabulary used by NaruDoc, not a general JSON Schema engine. */
export interface InputSchema {
  readonly type?: 'string' | 'integer' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean)[];
  readonly properties?: Readonly<Record<string, InputSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false | InputSchema;
  readonly items?: InputSchema;
  readonly oneOf?: readonly InputSchema[];
  readonly minimum?: number;
  readonly minItems?: number;
}
export type InputOf<S> =
  S extends { readonly enum: readonly (infer V)[] } ? V :
  S extends { readonly oneOf: readonly (infer V)[] } ? InputOf<V> :
  S extends { readonly type: 'string' } ? string :
  S extends { readonly type: 'integer' } ? number :
  S extends { readonly type: 'boolean' } ? boolean :
  S extends { readonly type: 'array'; readonly items: infer I } ? InputOf<I>[] :
  S extends { readonly type: 'object'; readonly properties: infer P; readonly required: readonly (infer R)[] } ?
    { -readonly [K in keyof P as K extends R ? K : never]: InputOf<P[K]> } &
    { -readonly [K in keyof P as K extends R ? never : K]?: InputOf<P[K]> } :
  S extends { readonly type: 'object'; readonly additionalProperties: infer V } ? Record<string, InputOf<V>> : never;

export function inputObject<const P extends Record<string, InputSchema>, const R extends readonly (keyof P & string)[]>(properties: P, required: R) {
  return { type: 'object', properties, required, additionalProperties: false } as const;
}
export function isInputObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function validateInput(schema: InputSchema, value: unknown, path = '$'): void {
  const invalid = (detail: string): never => { throw new NaruError('NARU_ARGUMENT', `${path}: ${detail}`); };
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(candidate => {
      try { validateInput(candidate, value, path); return true; } catch (error) { if (error instanceof NaruError) return false; throw error; }
    });
    if (matches.length !== 1) invalid('Expected exactly one supported input shape.');
    return;
  }
  if (schema.enum && !schema.enum.includes(value as string)) invalid(`Expected ${schema.enum.join(' | ')}.`);
  switch (schema.type) {
    case 'string': if (typeof value !== 'string' || !wellFormed(value)) invalid('Expected a well-formed Unicode string.'); break;
    case 'integer': if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (schema.minimum ?? Number.MIN_SAFE_INTEGER)) invalid('Expected a non-negative safe integer.'); break;
    case 'boolean': if (typeof value !== 'boolean') invalid('Expected a boolean.'); break;
    case 'array': {
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0)) invalid('Expected an array with enough items.');
      (value as unknown[]).forEach((item, index) => validateInput(schema.items!, item, `${path}[${index}]`)); break;
    }
    case 'object': {
      if (!isInputObject(value)) invalid('Expected a plain object.');
      const object = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (!Object.hasOwn(object, key)) invalid(`Missing field ${key}.`);
      for (const key of Object.keys(object)) {
        const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : schema.additionalProperties;
        if (!child) invalid(`Unknown field ${key}.`);
        validateInput(child as InputSchema, object[key], `${path}.${key}`);
      }
      break;
    }
  }
}
export function readInput<const S extends InputSchema>(schema: S, value: unknown): InputOf<S> {
  validateInput(schema, value); return value as InputOf<S>;
}
