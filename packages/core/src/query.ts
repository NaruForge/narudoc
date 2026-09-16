import { NaruError, type Block, type DocumentSnapshot, type Heading, type Section } from '@naruforge/narudoc-model';

export function sections(doc: DocumentSnapshot): Section[] {
  const headings = doc.blocks.filter((b): b is Heading => b.type === 'heading');
  const stack: Section[] = [], result: Section[] = [];
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1]!.heading.level >= heading.level) stack.pop()!.end = heading.range.start;
    const section: Section = { heading, start: heading.range.start, end: doc.source.length, parentStart: stack[stack.length - 1]?.start ?? null };
    result.push(section); stack.push(section);
  }
  return result;
}
export function getById(doc: DocumentSnapshot, id: string): Block {
  const matches = doc.blocks.filter(b => 'id' in b && b.id === id);
  if (matches.length !== 1) throw new NaruError('NARU_TARGET', `Expected one target for ID ${id}; found ${matches.length}.`);
  return matches[0]!;
}
export function getSection(doc: DocumentSnapshot, id: string): Section {
  const node = getById(doc, id);
  if (node.type !== 'heading') throw new NaruError('NARU_TARGET', `${id} is not a section heading.`);
  return sections(doc).find(s => s.start === node.range.start)!;
}
export function outline(doc: DocumentSnapshot) {
  return sections(doc).map(s => ({ id: s.heading.id ?? null, title: s.heading.title, level: s.heading.level, range: s.heading.range, sectionRange: { start: s.start, end: s.end }, parentStart: s.parentStart }));
}
export function getTable(doc: DocumentSnapshot, sectionId: string, index: number) {
  const section = getSection(doc, sectionId);
  const direct: Block[] = [];
  for (const block of doc.blocks.slice(doc.blocks.indexOf(section.heading) + 1)) {
    if (block.type === 'heading') break;
    direct.push(block);
  }
  const tables = direct.filter(block => block.type === 'table');
  if (!Number.isSafeInteger(index) || index < 0 || !tables[index]) throw new NaruError('NARU_TARGET', 'Table index is out of range.');
  return tables[index]!;
}
