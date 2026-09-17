import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startEditor } from '../../apps/web/dist/index.js';
import { parseDocument, planOperation } from '../../packages/core/dist/index.js';

let server, dir, file;
const tables = Array.from({ length: 9 }, (_, i) => `@table id="${i === 8 ? 'save' : 't' + i}" caption="Parameters ${i}"\n| Value |\n| --- |\n| ${i} |`).join('\n\n');
const original = '# Before {#before}\n\nBefore.\n\n# Main {#main}\n\nSee [@save] end.\n\n' + tables;
test.beforeEach(async ({ page }) => {
  await mkdir('.narudoc-scenarios', { recursive: true }); dir = await mkdtemp(resolve('.narudoc-scenarios/references-'));
  file = join(dir, 'refs.narudoc'); await writeFile(file, original); server = await startEditor(file);
  await page.goto(server.url); await expect(page.locator('#state')).toHaveText('Saved');
});
test.afterEach(async ({ page }) => { await page.close(); await server.close(); await rm(dir, { recursive: true, force: true }); });
const source = page => page.evaluate(() => window.narudoc.session.source);
async function select(page, text) {
  await page.evaluate(text => {
    const view = window.narudoc.editors[0].view; view.focus(); let found = false;
    view.state.doc.descendants((node, pos) => {
      if (found || !node.isText) return;
      const offset = node.text.indexOf(text); if (offset < 0) return;
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, pos + offset, pos + offset + text.length))); found = true;
    }); if (!found) throw Error('Missing text');
  }, text);
}
test('reference labels, scoped navigation, renumbering and save undo preserve source', async ({ page }) => {
  const ref = page.locator('#content [data-reference="save"]');
  await expect(ref).toHaveText('Table 9'); await expect(page.locator('[id="save"]')).toHaveCount(1);
  await ref.click(); await expect(page.locator('[data-table-id="save"]')).toBeInViewport(); expect(await source(page)).toBe(original);
  const numbered = planOperation(parseDocument(original), { type: 'insertTable', sectionId: 'before', id: 'new', headers: ['X'], rows: [] }).next.source;
  await writeFile(file, numbered); await page.locator('#reload').click(); await expect(ref).toHaveText('Table 10');
  await select(page, 'end.'); await page.keyboard.type('tail.');
  const edited = numbered.replace('[@save] end.', '[@save] tail.'); await expect.poll(() => source(page)).toBe(edited);
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved'); expect(await readFile(file, 'utf8')).toBe(edited);
  await page.evaluate(() => window.narudoc.editors[0].view.focus()); await page.keyboard.press('Control+z');
  // Each ordinary key is one supported gesture. Undo the complete typed replacement.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  await expect.poll(() => source(page)).toBe(numbered);
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved'); expect(await readFile(file, 'utf8')).toBe(numbered);
  await page.locator('#reload').click(); await expect(page.locator('#state')).toHaveText('Saved'); await expect(ref).toHaveText('Table 10');
  await select(page, 'end.'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace');
  const withoutSpace = numbered.replace('[@save] end.', '[@save]end.'); await expect.poll(() => source(page)).toBe(withoutSpace);
  await page.keyboard.press('Backspace'); expect(await source(page)).toBe(withoutSpace); await expect(page.getByRole('alert')).not.toBeEmpty();
});
test('invalid reference documents remain visible with unresolved labels and diagnostics', async ({ page }) => {
  const invalid = original.replace('[@save]', '[@missing]'); await writeFile(file, invalid); await page.locator('#reload').click();
  await expect(page.locator('#content .unresolved-reference')).toHaveText('[@missing]');
  await expect(page.locator('#diagnostics')).toContainText('NARU_REFERENCE'); await expect(page.locator('#save')).toBeDisabled();
  expect(await source(page)).toBe(invalid);
});
