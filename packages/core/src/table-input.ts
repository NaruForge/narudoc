import { NaruError, wellFormed, readInput, tableInputSchema, type TableInput } from '@naruforge/narudoc-model';
import { parseDocument } from '@naruforge/narudoc-parser';
import { annotationSource } from './reference-edit.js';

export function tableCellText(value: unknown): string {
  if (typeof value !== 'string' || !wellFormed(value) || /[\x00-\x1f\x7f]/.test(value) || value.trim() !== value) throw new NaruError('NARU_ARGUMENT', 'Cell must be a trimmed single-line Unicode string (empty allowed).');
  const doc = parseDocument(`# Table {#table}\n\n| ${value} |\n| --- |`);
  const table = doc.blocks[1];
  if (doc.diagnostics.length || doc.blocks.length !== 2 || table?.type !== 'table' || table.header.cells.length !== 1 || table.rows.length !== 0) throw new NaruError('NARU_ARGUMENT', 'Cell contains an unescaped delimiter or unsupported table syntax.');
  const range = table.header.cells[0]!.contentRange;
  if (doc.source.slice(range.start, range.end) !== value) throw new NaruError('NARU_ARGUMENT', 'Cell syntax changes its boundary.');
  return value;
}
export function readTableInput(value: unknown): TableInput {
  const input = readInput(tableInputSchema, value);
  const headers = input.headers.map(tableCellText);
  const rows = input.rows.map(row => {
    if (row.length !== headers.length) throw new NaruError('NARU_ARGUMENT', 'Every row must match header width.');
    return row.map(tableCellText);
  });
  if (input.caption !== undefined && input.id === undefined) throw new NaruError('NARU_ARGUMENT', 'Caption requires id.');
  if (input.id !== undefined) annotationSource(input.id, input.caption);
  return { headers, rows, ...(input.id === undefined ? {} : { id: input.id }), ...(input.caption === undefined ? {} : { caption: input.caption }) };
}
export function tableSource(input: TableInput, eol: string): string {
  const result = [input.headers, input.headers.map(() => '---'), ...input.rows].map(row => `| ${row.join(' | ')} |`).join(eol);
  const doc = parseDocument(`# Table {#table}${eol}${eol}${result}`), table = doc.blocks[1];
  const expectedRows = [input.headers, ...input.rows];
  if (doc.diagnostics.length || doc.blocks.length !== 2 || table?.type !== 'table' || table.rows.length !== input.rows.length ||
      [table.header, ...table.rows].some((row, i) => row.cells.length !== input.headers.length || row.cells.some((cell, j) => doc.source.slice(cell.contentRange.start, cell.contentRange.end) !== expectedRows[i]![j]))) throw new NaruError('NARU_ARGUMENT', 'Cell syntax crosses table boundaries.');
  return input.id === undefined ? result : annotationSource(input.id, input.caption) + eol + result;
}
