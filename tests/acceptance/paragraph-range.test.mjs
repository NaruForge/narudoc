import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, planBatch, planOperation } from '../../packages/core/dist/index.js';

const source = '\uFEFF# Control  {#control}\r\n\r\nAlpha **beta** gamma.\r\n\r\nDelta epsilon.\r\n\r\n## Details {#details}\r\n\r\nLeave [this link](#control) unchanged.\r\n';
const apply = operation => planOperation(parseDocument(source), operation).next.source;

test('paragraph split preserves marks and only changes the affected paragraph boundary', () => {
  const operation = { type: 'splitParagraph', id: 'control', index: 0, offset: 8, expected: 'Alpha beta gamma.' };
  assert.equal(apply(operation), '\uFEFF# Control  {#control}\r\n\r\nAlpha **be**\r\n\r\n**ta** gamma.\r\n\r\nDelta epsilon.\r\n\r\n## Details {#details}\r\n\r\nLeave [this link](#control) unchanged.\r\n');
  assert.throws(() => apply({ ...operation, expected: 'stale' }), { code: 'NARU_STALE' });
});

test('range replacement supports Unicode, plain multiline paste and cross-paragraph selection', () => {
  const unicode = planOperation(parseDocument('# A {#a}\n\n😀 alpha.'), { type: 'replaceParagraphRange', id: 'a', from: { index: 0, offset: 3 }, to: { index: 0, offset: 8 }, expected: 'alpha', text: '한글' }).next.source;
  assert.equal(unicode, '# A {#a}\n\n😀 한글.');
  const pasted = apply({ type: 'replaceParagraphRange', id: 'control', from: { index: 0, offset: 0 }, to: { index: 0, offset: 0 }, expected: '', text: 'First\nSecond\n\nThird' });
  assert.match(pasted, /First\r\n\r\nSecond\r\n\r\nThirdAlpha/);
  const cross = planOperation(parseDocument('# A {#a}\n\nFirst text.\n\nSecond text.\n\nThird.'), { type: 'replaceParagraphRange', id: 'a', from: { index: 0, offset: 6 }, to: { index: 1, offset: 6 }, expected: 'text.\nSecond', text: 'middle' }).next.source;
  assert.equal(cross, '# A {#a}\n\nFirst middle text.\n\nThird.');
});

test('join is restricted to adjacent direct paragraphs and protected content stays untouched', () => {
  const join = planOperation(parseDocument('# A {#a}\n\nFirst.\n\nSecond.\n\n- protected'), { type: 'joinParagraph', id: 'a', index: 0, expected: 'First.\nSecond.' }).next.source;
  assert.equal(join, '# A {#a}\n\nFirst.Second.\n\n- protected');
  assert.throws(() => planOperation(parseDocument(source), { type: 'replaceParagraphRange', id: 'details', from: { index: 0, offset: 6 }, to: { index: 0, offset: 15 }, expected: 'this link', text: 'x' }), { code: 'NARU_ARGUMENT' });
  assert.throws(() => apply({ type: 'replaceParagraphRange', id: 'control', from: { index: 0, offset: 0 }, to: { index: 0, offset: 0 }, expected: '', text: '# Not a paragraph' }), { code: 'NARU_ARGUMENT' });
});

test('cross-paragraph protection only examines selected inline content', () => {
  const protectedAfterSelection = '# A {#a}\n\nP0 plain.\n\nprefix text [protected](#a) suffix';
  const operation = { type: 'replaceParagraphRange', id: 'a', from: { index: 0, offset: 3 }, to: { index: 1, offset: 11 }, expected: 'plain.\nprefix text', text: 'merged' };
  const changed = planOperation(parseDocument(protectedAfterSelection), operation).next.source;
  assert.equal(changed, '# A {#a}\n\nP0 merged [protected](#a) suffix');
  assert.throws(() => planOperation(parseDocument(protectedAfterSelection), { ...operation, to: { index: 1, offset: 13 }, expected: 'plain.\nprefix text p' }), { code: 'NARU_ARGUMENT' });
});

test('range operations are atomic in a sequence and batch parity is exact', () => {
  const operations = [
    { type: 'splitParagraph', id: 'control', index: 0, offset: 5, expected: 'Alpha beta gamma.' },
    { type: 'replaceParagraphRange', id: 'control', from: { index: 1, offset: 0 }, to: { index: 1, offset: 5 }, expected: ' beta', text: ' BETA' },
  ];
  const plan = planBatch(parseDocument(source), { schemaVersion: 1, operations });
  assert.equal(plan.next.source, planOperation(parseDocument(planOperation(parseDocument(source), operations[0]).next.source), operations[1]).next.source);
  assert.throws(() => planBatch(parseDocument(source), { schemaVersion: 1, operations: [operations[0], { ...operations[1], expected: 'stale' }] }), error => error.code === 'NARU_STALE' && error.operationIndex === 1);
});
