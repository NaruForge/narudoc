import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startEditor } from '../../apps/web/dist/index.js';
import { parseDocument, planBatch, validateDocument } from '../../packages/core/dist/index.js';
const original = '---\ntitle: Fictional document\n---\n\n' + await readFile('examples/visual-fidelity.narudoc', 'utf8');
let server, dir, file;
test.beforeEach(async ({ page }) => {
  await mkdir('.narudoc-scenarios', { recursive: true }); dir = await mkdtemp(resolve('.narudoc-scenarios/browser-'));
  file = join(dir, 'fictional.narudoc'); await writeFile(file, original); server = await startEditor(file);
  await page.goto(server.url); await expect(page.locator('#state')).toHaveText('Saved');
});
test.afterEach(async ({ page }) => { page.removeAllListeners('dialog'); await page.close(); await server.close(); await rm(dir, { recursive: true, force: true }); });
const source = page => page.evaluate(() => window.narudoc.session.source);
async function select(page, kind, id, index, text) {
  await page.evaluate(({ kind, id, index, text }) => {
    const view = window.narudoc.editors.find(e => e.target.kind === kind && e.target.id === id && e.target.index === index).view;
    view.focus(); let found = false;
    view.state.doc.descendants((node, position) => {
      if (found || !node.isText) return;
      const offset = node.text.indexOf(text); if (offset < 0) return;
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, position + offset, position + offset + text.length))); found = true;
    }); if (!found) throw Error('Text not found');
  }, { kind, id, index, text });
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe(text);
}
const screenshot = async (page, name) => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: (process.env.CI ? 'test-results/' : 'docs/evidence/') + name + '.png', fullPage: true }); };
async function save(page) { await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#state')).toHaveText('Saved'); }
test('complete visual journey, API parity, save/reload/export and CLI consumers', async ({ page, context }) => {
  await expect(page.locator('#content')).toContainText('title: Fictional document');
  await page.locator('#save').focus(); await page.keyboard.press('Tab'); await expect(page.locator('#reload')).toBeFocused();
  await screenshot(page, '27-open');
  await page.getByRole('navigation').getByRole('button', { name: 'Control', exact: true }).click();
  await select(page, 'paragraph', 'control', 0, '400'); await page.keyboard.type('420');
  await expect.poll(() => source(page)).toBe(original.replace('400', '420'));
  await page.locator('#child [name=id]').fill('design'); await page.locator('#child [name=title]').fill('Design'); await page.getByRole('button', { name: 'Add child section', exact: true }).click();
  await expect(page.locator('#section option[value=design]')).toHaveCount(1); await page.locator('#section').selectOption('design');
  await page.locator('#paragraph [name=text]').fill('Review 한글 😀.'); await page.getByRole('button', { name: 'Add paragraph', exact: true }).click();
  await page.locator('#directive [name=id]').fill('REQ-002'); await page.locator('#directive [name=text]').fill('The device shall report its state.'); await page.getByRole('button', { name: 'Add directive', exact: true }).click();
  await page.locator('#directive-id').selectOption('REQ-002'); await page.locator('#attribute [name=value]').fill('reviewed'); await page.getByRole('button', { name: 'Set attribute', exact: true }).click();
  await select(page, 'directiveParagraph', 'REQ-002', 0, 'state'); await page.keyboard.type('status');
  await expect(page.locator('#diagnostics')).toContainText('warning · NARU_HIERARCHY');
  await expect(page.locator('#save')).toBeEnabled();
  const operations = await page.evaluate(() => window.narudoc.session.operations);
  const api = planBatch(parseDocument(original), { schemaVersion: 1, operations }).next;
  expect(await source(page)).toBe(api.source); expect(await readFile(file, 'utf8')).toBe(original);
  await screenshot(page, '27-edit'); await save(page); expect(await readFile(file, 'utf8')).toBe(api.source);
  await page.getByRole('button', { name: 'Reload', exact: true }).click(); await expect.poll(() => source(page)).toBe(api.source);
  await page.getByRole('button', { name: 'HTML export', exact: true }).click(); await expect(page.locator('#message')).toContainText('HTML exported');
  const html = await readFile(file + '.html', 'utf8'); const exported = await context.newPage(); await exported.setContent(html);
  await expect(exported.locator('table')).toBeVisible(); await expect(exported.getByRole('heading', { name: 'Design' })).toBeVisible(); expect(await exported.evaluate(() => window.documentExecuted)).toBeUndefined(); await exported.close();
  for (const command of [['inspect', file, '--json'], ['validate', file, '--json'], ['render', file, '--to', 'html']]) {
    const result = spawnSync(process.execPath, ['apps/cli/bin/narudoc.mjs', ...command], { encoding: 'utf8' }); expect(result.status, result.stderr).toBe(0);
  }
  expect(validateDocument(parseDocument(await readFile(file, 'utf8')))).toEqual(validateDocument(api));
});
test('invalid draft, cancel reload, locked/error save retain draft and disk', async ({ page }) => {
  await select(page, 'paragraph', 'control', 0, '400'); await page.keyboard.insertText('*bad*');
  await expect(page.locator('#state')).toHaveText('Unsaved invalid draft'); await expect(page.locator('#save')).toBeDisabled();
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#reload').click(); await expect(page.getByRole('textbox', { name: 'paragraph control 0', exact: true })).toContainText('*bad*');
  expect(await readFile(file, 'utf8')).toBe(original);
  await page.keyboard.press('Escape');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reload').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await select(page, 'paragraph', 'control', 0, '400'); await page.keyboard.type('420'); await writeFile(file + '.lock', 'writer');
  await page.locator('#save').click(); await expect(page.locator('#message')).toContainText('NARU_LOCKED'); await expect(page.locator('#state')).toHaveText('Unsaved changes');
  expect(await readFile(file, 'utf8')).toBe(original); await rm(file + '.lock');
  await page.route('**/api/save', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'EACCES', message: 'Permission denied (simulated response)' }) }));
  await page.locator('#save').click(); await expect(page.locator('#message')).toContainText('EACCES'); expect(await source(page)).toBe(original.replace('400', '420'));
  await page.unroute('**/api/save');
  await writeFile(file, 'x'.repeat(10 * 1024 * 1024 + 1)); await page.locator('#save').click(); await expect(page.locator('#message')).toContainText('NARU_LIMIT'); expect(await source(page)).toBe(original.replace('400', '420'));
});
test('external CLI edit and two-tab stale saves show latest revision without losing drafts', async ({ page, context }) => {
  const second = await context.newPage(); await second.goto(server.url); await expect(second.locator('#state')).toHaveText('Saved');
  await select(page, 'paragraph', 'control', 0, '400'); await page.keyboard.type('420');
  await select(second, 'paragraph', 'control', 0, '400'); await second.keyboard.type('430'); await save(second);
  await page.locator('#save').click(); await expect(page.locator('#message')).toContainText('Latest disk revision:'); expect(await source(page)).toBe(original.replace('400', '420')); expect(await readFile(file, 'utf8')).toBe(original.replace('400', '430'));
  await screenshot(page, '27-conflict'); await second.close();
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reload').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await select(page, 'paragraph', 'control', 0, '430'); await page.keyboard.type('440');
  const cli = spawnSync(process.execPath, ['apps/cli/bin/narudoc.mjs', 'heading', 'set-title', file, '--id', 'details', '--title', 'CLI changed'], { encoding: 'utf8' }); expect(cli.status, cli.stderr).toBe(0);
  await page.locator('#save').click(); await expect(page.locator('#message')).toContainText('NARU_STALE'); expect(await source(page)).toContain('440'); expect(await readFile(file, 'utf8')).toContain('CLI changed');
});
test('no-op and independent fidelity bytes for BOM/EOL/EOF, Korean composition and Unicode', async ({ page }) => {
  for (const eol of ['\n', '\r\n', '\r', 'mixed']) {
    const fixture = '\uFEFF' + (eol === 'mixed' ? original.replace(/\r?\n/g, (_, offset) => offset % 2 ? '\r\n' : '\n') : original.replace(/\r?\n/g, eol)).trimEnd();
    await writeFile(file, fixture); await page.locator('#reload').click(); await expect.poll(() => source(page)).toBe(fixture);
    const before = await stat(file); await save(page); expect((await stat(file)).mtimeMs).toBe(before.mtimeMs); expect(await readFile(file)).toEqual(Buffer.from(fixture));
    await select(page, 'paragraph', 'control', 0, '400'); const box = page.getByRole('textbox', { name: 'paragraph control 0', exact: true });
    await box.dispatchEvent('compositionstart', { data: '' }); await page.keyboard.insertText('한글😀'); await expect(page.locator('#save')).toBeDisabled(); expect(await source(page)).toBe(fixture);
    await box.dispatchEvent('compositionend', { data: '한글😀' }); await expect.poll(() => source(page)).toBe(fixture.replace('400', '한글😀')); await save(page);
    expect(await readFile(file)).toEqual(Buffer.from(fixture.replace('400', '한글😀')));
  }
  expect(await page.evaluate(() => window.documentExecuted)).toBeUndefined(); await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});
test('missing IDs and invalid documents stay visible and read only with diagnostics', async ({ page }) => {
  await writeFile(file, '# Missing ID\n\nKeep me.\n\n# A {#section}\n\n# Duplicate {#section}\n\n<script>window.bad=true</script>');
  await page.locator('#reload').click(); await expect(page.locator('#content')).toContainText('Keep me.'); await expect(page.locator('#diagnostics')).toContainText('error'); await expect(page.locator('#save')).toBeDisabled(); expect(await page.evaluate(() => window.bad)).toBeUndefined();
  await expect(page.locator('#section')).toHaveCount(1); await expect(page.locator('#content h1').nth(1)).toHaveText('A');
});
test('outline tracks edited titles and scrolls mixed ID/read-only headings correctly', async ({ page }) => {
  const fixture = '# Missing ID\n\n' + Array.from({ length: 30 }, () => 'Read only paragraph.\n\n').join('') + '# Editable {#editable}\n\nText';
  await writeFile(file, fixture); await page.locator('#reload').click();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Editable', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Editable', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'heading editable 0', exact: true })).toBeInViewport();
  await select(page, 'heading', 'editable', 0, 'Editable'); await page.keyboard.type('Changed');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Changed', exact: true })).toHaveCount(1);
  await expect(page.locator('#section option')).toHaveText('Changed');
});
