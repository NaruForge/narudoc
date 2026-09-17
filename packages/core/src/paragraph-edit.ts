import { boundary, inlineText, NaruError, type DocumentSnapshot, type Inline, type Paragraph, type TextEdit } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';
import { directSectionBody } from './query.js';
import { assertValid } from './validation.js';
import { applyTextEdits, minimalEdit } from './patch.js';

interface Point { index: number; offset: number }
interface Piece { node: Inline; original: boolean }
interface RangeRequest { id: string; from: Point; to: Point; expected: string; text: string }

const headingPattern = /^(#{1,6})[ \t]+/;
const fencePattern = /^(?:`{3,}|~{3,})[^\r\n]*$/;
const listPattern = /^([-+*]|\d{1,9}[.)])[ \t]+/;

function paragraphs(doc: DocumentSnapshot, id: string): Paragraph[] {
  return directSectionBody(doc, id).blocks.filter((block): block is Paragraph => block.type === 'paragraph');
}

function pointValue(point: Point, label: string): void {
  if (!Number.isSafeInteger(point.index) || point.index < 0 || !Number.isSafeInteger(point.offset) || point.offset < 0) {
    throw new NaruError('NARU_ARGUMENT', `${label} must contain non-negative safe integer index and offset.`);
  }
}

function paragraphAt(doc: DocumentSnapshot, id: string, point: Point, label: string): Paragraph {
  pointValue(point, label);
  const target = paragraphs(doc, id)[point.index];
  if (!target) throw new NaruError('NARU_TARGET', `${label} paragraph index is out of range.`);
  const value = inlineText(target.inline);
  if (!boundary(value, point.offset)) throw new NaruError('NARU_TARGET', `${label} offset is out of range or splits Unicode.`);
  return target;
}

function copy(node: Inline): Inline {
  if (node.type === 'text' || node.type === 'code') return { ...node };
  if (node.type === 'link') return { ...node, children: node.children.map(copy) };
  if (node.type === 'strong' || node.type === 'emphasis') return { ...node, children: node.children.map(copy) };
  throw new NaruError('NARU_ARGUMENT', 'Unknown inline node.');
}

function sourceMatches(source: string, node: Inline): boolean {
  return node.type === 'text' && !!node.range && source.slice(node.range.start, node.range.end) === node.value;
}

/** Slice displayed inline text without allowing a protected node to be cut. */
function slicePieces(source: string, nodes: Inline[], from: number, to: number): Piece[] {
  const result: Piece[] = [];
  let cursor = 0;
  for (const node of nodes) {
    const length = inlineText([node]).length;
    const start = cursor, end = cursor + length;
    cursor = end;
    if (to <= start) break;
    if (from >= end) continue;
    const localFrom = Math.max(0, from - start), localTo = Math.min(length, to - start);
    const complete = localFrom === 0 && localTo === length;
    if (node.type === 'text') {
      if (!complete && !sourceMatches(source, node)) throw new NaruError('NARU_ARGUMENT', 'Escaped inline text cannot be partially edited.');
      if (complete) result.push({ node: copy(node), original: true });
      else result.push({ node: { type: 'text', value: node.value.slice(localFrom, localTo) }, original: false });
      continue;
    }
    if (node.type === 'code' || node.type === 'link') {
      if (!complete) throw new NaruError('NARU_ARGUMENT', 'Link and inline code boundaries are protected.');
      result.push({ node: copy(node), original: true });
      continue;
    }
    if (node.type !== 'strong' && node.type !== 'emphasis') throw new NaruError('NARU_ARGUMENT', 'Unknown inline node.');
    const children = slicePieces(source, node.children, localFrom, localTo);
    if (children.length) {
      const sliced: Inline = complete && children.every(piece => piece.original)
        ? copy(node)
        : { type: node.type, children: children.map(piece => piece.node) };
      result.push({ node: sliced, original: complete && children.every(piece => piece.original) });
    }
  }
  return result;
}

function protectedOverlap(source: string, nodes: Inline[], from: number, to: number, cursor = 0): void {
  for (const node of nodes) {
    const length = inlineText([node]).length, start = cursor, end = cursor + length;
    if (to > start && from < end) {
      if (node.type === 'code' || node.type === 'link') throw new NaruError('NARU_ARGUMENT', 'Link and inline code content are protected.');
      if (node.type === 'text' && !sourceMatches(source, node)) throw new NaruError('NARU_ARGUMENT', 'Escaped inline text is protected.');
      if (node.type === 'strong' || node.type === 'emphasis') protectedOverlap(source, node.children, from, to, start);
    }
    cursor = end;
  }
}

function marksAt(nodes: Inline[], offset: number, cursor = 0, marks: Array<'strong' | 'emphasis'> = []): Array<'strong' | 'emphasis'> {
  for (const node of nodes) {
    const length = inlineText([node]).length, start = cursor, end = cursor + length;
    if (offset < end || (offset === end && end === cursor + length && node === nodes.at(-1))) {
      if (node.type === 'strong' || node.type === 'emphasis') return marksAt(node.children, offset, start, [...marks, node.type]);
      return marks;
    }
    cursor = end;
  }
  return marks;
}

function wrap(value: string, marks: Array<'strong' | 'emphasis'>): Piece {
  let node: Inline = { type: 'text', value };
  for (const mark of [...marks].reverse()) node = { type: mark, children: [node] };
  return { node, original: false };
}

function escapePlainText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[`*\[\]()]/g, '\\$&');
}

function renderPiece(source: string, piece: Piece): string {
  const node = piece.node;
  if (piece.original && node.range) return source.slice(node.range.start, node.range.end);
  if (node.type === 'text') return escapePlainText(node.value);
  if (node.type === 'code' || node.type === 'link') throw new NaruError('NARU_ARGUMENT', 'Protected inline content cannot be rewritten.');
  if (node.type !== 'strong' && node.type !== 'emphasis') throw new NaruError('NARU_ARGUMENT', 'Unknown inline node.');
  const marker = node.type === 'strong' ? '**' : '*';
  return marker + node.children.map(child => renderPiece(source, { node: child, original: false })).join('') + marker;
}

function renderPieces(source: string, pieces: Piece[]): string {
  return pieces.map(piece => renderPiece(source, piece)).join('');
}

function normalizePaste(text: string): string[] {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  if (normalized === '\n') return ['', ''];
  const hasLineBreak = normalized.includes('\n');
  const lines = normalized.split('\n').filter(line => line.length > 0);
  if (!lines.length) return [];
  for (const line of lines) {
    if ((hasLineBreak && !line.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f`*\[\]\\()]/.test(line) || headingPattern.test(line) || fencePattern.test(line) || listPattern.test(line) || line.startsWith(':::')) {
      throw new NaruError('NARU_ARGUMENT', 'Plain replacement would create an unsupported structural block.');
    }
  }
  return lines;
}

function paragraphSources(doc: DocumentSnapshot, request: RangeRequest, mode: 'replace' | 'split' | 'join'): { sources: string[]; expectedTexts: string[]; first: Paragraph; last: Paragraph; firstIndex: number; lastIndex: number } {
  const ps = paragraphs(doc, request.id);
  const first = paragraphAt(doc, request.id, request.from, 'Start');
  const last = paragraphAt(doc, request.id, request.to, 'End');
  if (request.from.index > request.to.index || (request.from.index === request.to.index && request.from.offset > request.to.offset)) throw new NaruError('NARU_TARGET', 'Paragraph range must be ordered.');
  for (let index = request.from.index; index <= request.to.index; index++) {
    const block = ps[index]!;
    const blockIndex = doc.blocks.indexOf(block);
    if (index > request.from.index && blockIndex !== doc.blocks.indexOf(ps[index - 1]!) + 1) throw new NaruError('NARU_ARGUMENT', 'Paragraph range cannot cross a protected block.');
  }
  const firstText = inlineText(first.inline), lastText = inlineText(last.inline), middleText = ps.slice(request.from.index + 1, request.to.index).map(block => inlineText(block.inline)).join('\n');
  const selected = mode === 'split'
    ? firstText
    : mode === 'join'
      ? firstText + '\n' + lastText
      : request.from.index === request.to.index
        ? firstText.slice(request.from.offset, request.to.offset)
        : firstText.slice(request.from.offset) + '\n' + (middleText ? middleText + '\n' : '') + lastText.slice(0, request.to.offset);
  if (selected !== request.expected) throw new NaruError('NARU_STALE', 'Selected paragraph text no longer matches the snapshot.');
  const startNodes = first.inline, endNodes = last.inline;
  const sameParagraph = request.from.index === request.to.index;
  protectedOverlap(doc.source, startNodes, request.from.offset, sameParagraph ? request.to.offset : firstText.length);
  if (!sameParagraph) {
    protectedOverlap(doc.source, endNodes, 0, request.to.offset);
    for (const block of ps.slice(request.from.index + 1, request.to.index + 1)) protectedOverlap(doc.source, block.inline, 0, inlineText(block.inline).length);
  }
  const fromMarks = marksAt(startNodes, request.from.offset);
  const toMarks = marksAt(endNodes, request.to.offset);
  if (mode === 'replace' && request.from.index !== request.to.index && JSON.stringify(fromMarks) !== JSON.stringify(toMarks)) throw new NaruError('NARU_ARGUMENT', 'A cross-paragraph replacement cannot cross a mark boundary.');
  const before = slicePieces(doc.source, startNodes, 0, request.from.offset);
  const after = sameParagraph ? slicePieces(doc.source, startNodes, request.to.offset, firstText.length) : slicePieces(doc.source, endNodes, request.to.offset, lastText.length);
  const beforeText = firstText.slice(0, request.from.offset), afterText = lastText.slice(request.to.offset);
  let sources: string[];
  let expectedTexts: string[];
  if (mode === 'split') {
    if (!sameParagraph || request.from.offset !== request.to.offset) throw new NaruError('NARU_ARGUMENT', 'Split requires one paragraph and a collapsed offset.');
    const right = slicePieces(doc.source, startNodes, request.from.offset, firstText.length);
    sources = [renderPieces(doc.source, before), renderPieces(doc.source, right)];
    expectedTexts = [beforeText, afterText];
  } else if (mode === 'join') {
    if (request.from.index === request.to.index || request.from.offset !== firstText.length || request.to.offset !== 0) throw new NaruError('NARU_ARGUMENT', 'Join requires the end of one paragraph and the start of the next.');
    sources = [renderPieces(doc.source, [...slicePieces(doc.source, startNodes, 0, firstText.length), ...slicePieces(doc.source, endNodes, 0, lastText.length)])];
    expectedTexts = [firstText + lastText];
  } else {
    const parts = normalizePaste(request.text);
    const insertMarks = JSON.stringify(fromMarks) === JSON.stringify(toMarks) ? fromMarks : [];
    if (!parts.length) {
      sources = [renderPieces(doc.source, [...before, ...after])];
      expectedTexts = [beforeText + afterText];
    } else if (parts.length === 1) {
      sources = [renderPieces(doc.source, [...before, wrap(parts[0]!, insertMarks), ...after])];
      expectedTexts = [beforeText + parts[0]! + afterText];
    } else {
      sources = [renderPieces(doc.source, [...before, wrap(parts[0]!, insertMarks)])];
      expectedTexts = [beforeText + parts[0]!];
      for (const part of parts.slice(1, -1)) { sources.push(renderPieces(doc.source, [wrap(part, insertMarks)])); expectedTexts.push(part); }
      sources.push(renderPieces(doc.source, [wrap(parts.at(-1)!, insertMarks), ...after]));
      expectedTexts.push(parts.at(-1)! + afterText);
    }
  }
  if (sources.some((value, index) => !value || !expectedTexts[index] || !expectedTexts[index]!.trim())) throw new NaruError('NARU_ARGUMENT', 'An empty paragraph remains projection-only and cannot be committed.');
  return { sources, expectedTexts, first, last, firstIndex: request.from.index, lastIndex: request.to.index };
}

function planParagraphSource(doc: DocumentSnapshot, request: RangeRequest, mode: 'replace' | 'split' | 'join'): { edits: TextEdit[]; next: DocumentSnapshot } {
  const plan = paragraphSources(doc, request, mode);
  const replacement = plan.sources.join(doc.eol.repeat(2));
  const edits = minimalEdit(doc.source, plan.first.range.start, plan.last.range.end, replacement);
  const next = parseDocument(applyTextEdits(doc.source, edits));
  assertValid(next);
  const body = directSectionBody(next, request.id).blocks;
  const nextParagraphs = body.filter((block): block is Paragraph => block.type === 'paragraph');
  const expectedCount = paragraphs(doc, request.id).length - (plan.lastIndex - plan.firstIndex + 1) + plan.sources.length;
  if (nextParagraphs.length !== expectedCount) throw new NaruError('NARU_ARGUMENT', 'Replacement text created an unsupported document structure.');
  const actual = nextParagraphs.slice(plan.firstIndex, plan.firstIndex + plan.expectedTexts.length).map(block => inlineText(block.inline));
  if (JSON.stringify(actual) !== JSON.stringify(plan.expectedTexts)) throw new NaruError('NARU_ARGUMENT', 'Replacement text changed paragraph structure or markup.');
  return { edits, next };
}

export function planSplitParagraph(doc: DocumentSnapshot, operation: { id: string; index: number; offset: number; expected: string }) {
  return planParagraphSource(doc, { id: operation.id, from: { index: operation.index, offset: operation.offset }, to: { index: operation.index, offset: operation.offset }, expected: operation.expected, text: '' }, 'split');
}

export function planJoinParagraph(doc: DocumentSnapshot, operation: { id: string; index: number; expected: string }) {
  const left = paragraphAt(doc, operation.id, { index: operation.index, offset: 0 }, 'Join');
  const ps = paragraphs(doc, operation.id), right = ps[operation.index + 1];
  if (!right) throw new NaruError('NARU_TARGET', 'Join has no following paragraph.');
  const expected = inlineText(left.inline) + '\n' + inlineText(right.inline);
  if (expected !== operation.expected) throw new NaruError('NARU_STALE', 'Joined paragraph text no longer matches the snapshot.');
  return planParagraphSource(doc, { id: operation.id, from: { index: operation.index, offset: inlineText(left.inline).length }, to: { index: operation.index + 1, offset: 0 }, expected, text: '' }, 'join');
}

export function planReplaceParagraphRange(doc: DocumentSnapshot, operation: RangeRequest) {
  return planParagraphSource(doc, operation, 'replace');
}
