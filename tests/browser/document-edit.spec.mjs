import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startEditor } from '../../apps/web/dist/index.js';

const fixture = '# Control  {#control}\n\nAlpha **beta** gamma.\n\nDelta epsilon.\n\n## Details {#details}\n\nLeave [this link](#control) unchanged.';
let server, directory, file;

test.beforeEach(async ({ page }) => {
  await mkdir('.narudoc-scenarios', { recursive: true });
  directory = await mkdtemp(resolve('.narudoc-scenarios/document-edit-'));
  file = join(directory, 'document.narudoc'); await writeFile(file, fixture);
  server = await startEditor(file); await page.goto(server.url); await expect(page.locator('#state')).toHaveText('Saved');
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
