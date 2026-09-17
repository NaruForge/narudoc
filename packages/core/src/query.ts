import { NaruError, type Block, type DocumentSnapshot, type Heading, type Paragraph, type Section, type TextTarget } from '@naruforge/narudoc-model';

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
/** Direct body ends at the very next heading, including a child heading. */
export function directSectionBody(doc: DocumentSnapshot, id: string) {
  const section = getSection(doc, id), startIndex = doc.blocks.indexOf(section.heading) + 1;
  let endIndex = startIndex;
  while (endIndex < doc.blocks.length && doc.blocks[endIndex]!.type !== 'heading') endIndex++;
  return { section, startIndex, endIndex, blocks: doc.blocks.slice(startIndex, endIndex) };
}
export function textTarget(doc: DocumentSnapshot, target: TextTarget): Heading | Paragraph {
  if (!Number.isSafeInteger(target.index) || target.index < 0) throw new NaruError('NARU_ARGUMENT', 'Text target index must be a non-negative safe integer.');
  if (target.kind === 'heading') {
    if (target.index !== 0) throw new NaruError('NARU_ARGUMENT', 'Heading index must be zero.');
    return getSection(doc, target.id).heading;
  }
  let paragraphs: Paragraph[];
  if (target.kind === 'directiveParagraph') {
    const node = getById(doc, target.id);
    if (node.type !== 'directive') throw new NaruError('NARU_TARGET', 'Expected directive.');
    paragraphs = node.children.filter(b => b.type === 'paragraph');
  } else if (target.kind === 'paragraph') paragraphs = directSectionBody(doc, target.id).blocks.filter(b => b.type === 'paragraph');
  else throw new NaruError('NARU_ARGUMENT', 'Unknown text target kind.');
  const paragraph = paragraphs[target.index];
  if (!paragraph) throw new NaruError('NARU_TARGET', 'Paragraph index is out of range.');
  return paragraph;
}
/** Snapshot-relative authoring targets, not persistent node identities. */
export function textTargets(doc: DocumentSnapshot): Array<{ target: TextTarget; block: Heading | Paragraph }> {
  const result: Array<{ target: TextTarget; block: Heading | Paragraph }> = [];
  let sectionId: string | undefined, index = 0;
  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      sectionId = block.id; index = 0;
      if (block.id) result.push({ target: { kind: 'heading', id: block.id, index: 0 }, block });
    } else if (block.type === 'paragraph' && sectionId) result.push({ target: { kind: 'paragraph', id: sectionId, index: index++ }, block });
    else if (block.type === 'directive' && block.id) {
      let paragraphIndex = 0;
      for (const child of block.children) if (child.type === 'paragraph') result.push({ target: { kind: 'directiveParagraph', id: block.id, index: paragraphIndex++ }, block: child });
    }
  }
  return result;
}
export function targetMetadata(doc: DocumentSnapshot, id: string) {
  getById(doc, id);
  return textTargets(doc).filter(item => item.target.id === id).map(({ target, block }) => ({
    ...target,
    operation: target.kind === 'heading' ? 'setHeadingTitle' : target.kind === 'paragraph' ? 'replaceParagraph' : 'replaceDirectiveParagraph',
    text: block.type === 'heading' ? block.title : doc.source.slice(block.range.start, block.range.end),
    scope: 'current-step-snapshot' as const,
  }));
}
export function getTable(doc: DocumentSnapshot, sectionId: string, index: number) {
  const tables = directSectionBody(doc, sectionId).blocks.filter(block => block.type === 'table');
  if (!Number.isSafeInteger(index) || index < 0 || !tables[index]) throw new NaruError('NARU_TARGET', 'Table index is out of range.');
  return tables[index]!;
}
