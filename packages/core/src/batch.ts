import { BatchOperationError, NaruError, isInputObject, readOperation, type BatchEditPlan, type DocumentSnapshot } from '@naruforge/narudoc-model';
import { planOperation } from './operations.js';
import { assertValid } from './validation.js';

/** Historical public batch/CLI request policy, not a semantic transaction limit. */
export const BATCH_OPERATION_LIMIT = 100;
/** Sequential semantic planning. Hosts own resource limits and persist only the final result. */
export function planSequence(doc: DocumentSnapshot, operations: readonly unknown[], options: { collectSteps?: boolean } = {}): BatchEditPlan {
  if (!Array.isArray(operations)) throw new NaruError('NARU_ARGUMENT', 'Expected operations array.');
  assertValid(doc);
  let next = doc;
  const steps: BatchEditPlan['steps'] = [];
  for (let operationIndex = 0; operationIndex < operations.length; operationIndex++) {
    try {
      // Validate lazily: preserve first failing step even if a later input is malformed.
      const plan = planOperation(next, readOperation(operations[operationIndex]));
      if (options.collectSteps !== false) steps.push({ operationIndex, edits: plan.edits });
      next = plan.next;
    } catch (error) {
      if (error instanceof NaruError) throw new BatchOperationError(operationIndex, error);
      throw error;
    }
  }
  return { baseSource: doc.source, steps, next };
}
export function planBatch(doc: DocumentSnapshot, request: unknown): BatchEditPlan {
  if (!isInputObject(request) || Object.keys(request).length !== 2 || !Object.hasOwn(request, 'schemaVersion') ||
      !Object.hasOwn(request, 'operations') || request.schemaVersion !== 1 || !Array.isArray(request.operations)) {
    throw new NaruError('NARU_ARGUMENT', 'Expected { schemaVersion: 1, operations: [...] }.');
  }
  if (request.operations.length < 1 || request.operations.length > BATCH_OPERATION_LIMIT) throw new NaruError('NARU_ARGUMENT', 'A batch must contain 1 to 100 operations.');
  return planSequence(doc, request.operations);
}
