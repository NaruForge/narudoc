import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startEditor } from '../../apps/web/dist/index.js';

const fixture = '# Control  {#control}\n\nAlpha **beta** gamma.\n\nDelta epsilon.\n\n## Details {#details}\n\nLeave [this link](#control) unchanged.\n\n:::note\nid: NOTE\n\nDirective plain **bold** *em* [protected](#control) `code` \\*escaped.\n:::';
let server, directory, file;

test.beforeEach(async ({ page }) => {
  await mkdir('.narudoc-scenarios', { recursive: true });
  directory = await mkdtemp(resolve('.narudoc-scenarios/document-edit-'));
  file = join(directory, 'document.narudoc'); await writeFile(file, fixture);
  server = await startEditor(file); await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(server.url).origin });
  await page.goto(server.url); await expect(page.locator('#state')).toHaveText('Saved');
});
test.afterEach(async ({ page }) => { await page.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });

const source = page => page.evaluate(() => window.narudoc.session.source);
async function selectText(page, kind, id, index, text) {
  await page.evaluate(({ kind, id, index, text }) => {
    const editor = window.narudoc.editors.find(item => item.target.kind === kind && item.target.id === id && item.target.index === index);
    const view = editor.view; view.focus(); let found = false;
    view.state.doc.descendants((node, position) => {
      if (found || !node.isText) return;
      const at = node.text.indexOf(text); if (at < 0) return;
      const Selection = view.state.selection.constructor;
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, position + at, position + at + text.length))); found = true;
    });
    if (!found) throw Error('Text not found: ' + text);
  }, { kind, id, index, text });
}
async function paste(page, text) {
  await page.evaluate(value => {
    const view = window.narudoc.editors[0].view;
    const data = new DataTransfer(); data.setData('text/plain', value);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (!view.someProp('handlePaste', handler => handler(view, event))) throw Error('Paste handler did not accept the event.');
  }, text);
}
async function selectProtected(page, label) {
  await page.evaluate(value => {
    const view = window.narudoc.editors[0].view; view.focus(); let found = false;
    view.state.doc.descendants((node, position) => {
      if (found || node.type.name !== 'protectedInline' || node.attrs.label !== value) return;
      const Selection = view.state.selection.constructor;
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, position, position + node.nodeSize))); found = true;
    });
    if (!found) throw Error('Protected inline not found: ' + value);
  }, label);
}
async function dragSelection(page, startText, endText) {
  const points = await page.locator('#content .ProseMirror').evaluate((root, input) => {
    const point = (text, end) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) {
        const offset = node.data.indexOf(text); if (offset < 0) continue;
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + text.length);
        const rects = [...range.getClientRects()], rect = end ? rects.at(-1) : rects[0];
        if (!rect) throw Error('Text has no pointer rectangle: ' + text);
        return { x: end ? rect.right - 2 : rect.left + 2, y: rect.top + rect.height / 2 };
      }
      throw Error('Pointer text not found: ' + text);
    };
    return { start: point(input.startText, false), end: point(input.endText, true) };
  }, { startText, endText });
  await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 }); await page.mouse.up();
}

test('document projection supports split, join, multiline plain paste and one-gesture undo/redo', async ({ page }) => {
  await selectText(page, 'paragraph', 'control', 0, 'Alpha');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'paragraph control 1', exact: true })).toBeVisible();
  await page.keyboard.type('First ');
  await page.keyboard.press('Home'); await page.keyboard.press('Backspace');
  expect(await page.locator('#content').getByRole('textbox', { name: 'paragraph control 2', exact: true })).toHaveCount(0);
  const beforePaste = await source(page);
  await selectText(page, 'paragraph', 'control', 0, 'AlphaFirst');
  await paste(page, 'First\nSecond\n\nThird');
  const afterPaste = await source(page);
  expect(afterPaste).toContain('First\n\nSecond\n\nThird'); expect(afterPaste).toContain('## Details {#details}');
  await page.keyboard.press('Control+z'); await expect.poll(() => source(page)).toBe(beforePaste);
  await page.keyboard.press('Control+y'); await expect.poll(() => source(page)).toBe(afterPaste);
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await page.evaluate(() => window.narudoc.editors[0].view.focus()); await page.keyboard.press('Control+z'); await expect.poll(() => source(page)).toBe(beforePaste);
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  expect(await readFile(file, 'utf8')).toBe(beforePaste);
});

test('boundary Enter keeps an empty projection draft out of source until text is entered', async ({ page }) => {
  await selectText(page, 'paragraph', 'control', 0, 'gamma.'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  expect(await source(page)).toBe(fixture);
  expect(await page.evaluate(() => window.narudoc.session.drafts.has('document-projection'))).toBe(true);
  await page.keyboard.type('Tail');
  await expect.poll(() => source(page)).toContain('gamma.\n\nTail');
  expect(await page.evaluate(() => window.narudoc.session.drafts.has('document-projection'))).toBe(false);
});

test('directive ordinary text editing preserves marks and rejects protected inline edits', async ({ page }) => {
  await selectText(page, 'directiveParagraph', 'NOTE', 0, 'Directive'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('Start ');
  await expect.poll(() => source(page)).toContain('Start Directive plain **bold** *em*');
  await selectText(page, 'directiveParagraph', 'NOTE', 0, 'plain'); await page.keyboard.type('text');
  await selectText(page, 'directiveParagraph', 'NOTE', 0, 'text'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toContain('Directive tex **bold**');
  await page.keyboard.press('Delete'); await expect.poll(() => source(page)).toContain('Directive tex**bold**');
  await selectText(page, 'directiveParagraph', 'NOTE', 0, 'bold'); await page.keyboard.type('strong');
  await selectText(page, 'directiveParagraph', 'NOTE', 0, 'em'); await page.keyboard.type('focus');
  await expect.poll(() => source(page)).toContain('tex**strong** *focus* [protected](#control) `code` \\*escaped.');
  for (const label of ['protected', 'code', ' *escaped.']) {
    const before = await source(page); await selectProtected(page, label); await page.keyboard.press('Backspace');
    expect(await source(page)).toBe(before); await expect(page.getByRole('alert')).not.toBeEmpty();
  }
  const saved = await source(page); await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await page.locator('#reload').click(); await expect(page.locator('#state')).toHaveText('Saved');
  expect(await source(page)).toBe(saved); await expect(page.locator('#diagnostics')).toContainText('No validation errors');
});

test('heading deletion and heading-end Enter preserve the document projection contract', async ({ page }) => {
  await selectText(page, 'heading', 'control', 0, 'Control'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toContain('# Contro  {#control}');
  await selectText(page, 'heading', 'control', 0, 'Contro'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Delete');
  await expect.poll(() => source(page)).toContain('# ontro  {#control}');
  await selectText(page, 'heading', 'details', 0, 'Details'); await page.keyboard.press('ArrowRight'); const beforeEnter = await source(page); await page.keyboard.press('Enter');
  expect(await source(page)).toBe(beforeEnter); expect(await page.evaluate(() => window.narudoc.session.drafts.has('document-projection'))).toBe(true);
  await page.keyboard.type('Intro');
  await expect.poll(() => source(page)).toContain('## Details {#details}\n\nIntro\n\nLeave [this link](#control) unchanged.');
  expect(await page.evaluate(() => window.narudoc.session.drafts.has('document-projection'))).toBe(false);
});

test('pointer selection supports cut and plain clipboard paste as single undo gestures', async ({ page }) => {
  await dragSelection(page, 'gamma.', 'Delta');
  const selected = await page.evaluate(() => getSelection().toString()); expect(selected).toContain('gamma.'); expect(selected).toContain('Delta');
  await page.keyboard.press('Control+x'); const cut = await source(page); expect(cut).not.toBe(fixture); expect(cut).toContain('Alpha **beta**  epsilon.');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText()); expect(clipboard).toContain('gamma.'); expect(clipboard).toContain('Delta');
  await page.keyboard.press('Control+z'); await expect.poll(() => source(page)).toBe(fixture);
  await selectText(page, 'paragraph', 'control', 1, 'Delta'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Control+v');
  const pasted = await source(page); expect(pasted).not.toBe(fixture); expect(pasted).toContain('Deltagamma.\n\nDelta epsilon.');
  await page.keyboard.press('Control+z'); await expect.poll(() => source(page)).toBe(fixture);
});
