import { BatchOperationError, NaruError, wellFormed, type BatchEditPlan, type DocumentSnapshot, type Operation } from '@naruforge/narudoc-model';
import { planOperation } from './operations.js';
import { assertValid } from './validation.js';
import { readInsertDirective } from './directive-input.js';
import { readTableInput } from './table-input.js';

const fields: Record<Operation['type'], readonly string[]> = {
  setInlineText: ['type', 'kind', 'id', 'index', 'path', 'expected', 'text'],
  insertTable: ['type', 'sectionId', 'headers', 'rows'],
  setTableCell: ['type', 'sectionId', 'tableIndex', 'part', 'row', 'column', 'text'],
  insertDirective: ['type', 'sectionId', 'name', 'id', 'attributes', 'children'],
  renameId: ['type', 'id', 'newId'],
  setHeadingTitle: ['type', 'id', 'title'],
  insertSection: ['type', 'after', 'id', 'title'],
  insertChildSection: ['type', 'parent', 'id', 'title'],
  removeSection: ['type', 'id'],
  moveSection: ['type', 'id', 'after'],
  replaceParagraph: ['type', 'id', 'index', 'text'],
  insertParagraph: ['type', 'id', 'index', 'text'],
  replaceDirectiveParagraph: ['type', 'id', 'index', 'text'],
  setDirectiveAttribute: ['type', 'id', 'key', 'value'],
};
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function operation(value: unknown): Operation {
  if (!object(value) || typeof value.type !== 'string' || !Object.hasOwn(fields, value.type)) {
    throw new NaruError('NARU_ARGUMENT', 'Expected a supported operation object.');
  }
  const keys = fields[value.type as Operation['type']];
  if (value.type === 'insertDirective') return readInsertDirective(value);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new NaruError('NARU_ARGUMENT', 'Operation fields must exactly match its type.');
  }
  if (value.type === 'insertTable') {
    if (typeof value.sectionId !== 'string' || !wellFormed(value.sectionId)) throw new NaruError('NARU_ARGUMENT', 'sectionId must be a Unicode string.');
    return { type: 'insertTable', sectionId: value.sectionId, ...readTableInput({ headers: value.headers, rows: value.rows }) };
  }
  for (const key of keys) {
    const field = value[key];
    if (['index', 'tableIndex', 'row', 'column'].includes(key)) {
      if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) throw new NaruError('NARU_ARGUMENT', 'index must be a non-negative safe integer.');
    } else if (typeof field !== 'string' || !wellFormed(field)) {
      throw new NaruError('NARU_ARGUMENT', `${key} must be a well-formed Unicode string.`);
    }
  }
  return value as unknown as Operation;
}

/** Plans existing semantic operations in order, without mutating the input or performing I/O. */
export function planBatch(doc: DocumentSnapshot, request: unknown): BatchEditPlan {
  if (!object(request) || Object.keys(request).length !== 2 || !Object.hasOwn(request, 'schemaVersion') ||
      !Object.hasOwn(request, 'operations') || request.schemaVersion !== 1 || !Array.isArray(request.operations)) {
    throw new NaruError('NARU_ARGUMENT', 'Expected { schemaVersion: 1, operations: [...] }.');
  }
  if (request.operations.length < 1 || request.operations.length > 100) {
    throw new NaruError('NARU_ARGUMENT', 'A batch must contain 1 to 100 operations.');
  }
  assertValid(doc);
  let next = doc;
  const steps: BatchEditPlan['steps'] = [];
  for (let operationIndex = 0; operationIndex < request.operations.length; operationIndex++) {
    try {
      const plan = planOperation(next, operation(request.operations[operationIndex]));
      steps.push({ operationIndex, edits: plan.edits });
      next = plan.next;
    } catch (error) {
      if (error instanceof NaruError) throw new BatchOperationError(operationIndex, error);
      throw error;
    }
  }
  return { baseSource: doc.source, steps, next };
}
