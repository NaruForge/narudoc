import { test, expect } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startEditor } from '../../apps/web/dist/index.js';

let server, dir, file;
const assets = fileURLToPath(new URL('../../examples/assets/', import.meta.url));
const original = '# Control {#control}\n\nThe loop is in [@fig-control].\n\n@figure id="fig-control" src="assets/control.png" alt="Control loop diagram" caption="Control layout"\n';
test.beforeEach(async ({ page }) => {
  await mkdir('.narudoc-scenarios', { recursive: true }); dir = await mkdtemp(resolve('.narudoc-scenarios/figure-'));
  await mkdir(join(dir, 'assets'));
  await copyFile(join(assets, 'control.png'), join(dir, 'assets', 'control.png'));
  await copyFile(join(assets, 'control-revised.png'), join(dir, 'assets', 'control-revised.png'));
  file = join(dir, 'design.narudoc'); await writeFile(file, original); server = await startEditor(file);
  await page.goto(server.url); await expect(page.locator('#state')).toHaveText('Saved');
});
test.afterEach(async ({ page }) => { await page.close(); await server.close(); await rm(dir, { recursive: true, force: true }); });
const source = page => page.evaluate(() => window.narudoc.session.source);

test('figure displays through the session asset route and references navigate', async ({ page }) => {
  const image = page.locator('#content figure img');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^\/api\/asset\/[0-9a-f]{64}$/);
  await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(8);
  await expect(page.locator('#content figcaption')).toHaveText('Figure 1: Control layout');
  const reference = page.locator('#content [data-reference="fig-control"]');
  await expect(reference).toHaveText('Figure 1');
  await reference.click();
  await expect(page.locator('[data-table-id="fig-control"]')).toBeInViewport();
  expect(await source(page)).toBe(original);
});

test('insert, replace, save, reload and export keep IDs and linked assets portable', async ({ page }) => {
  // Replace the image while keeping the figure ID and its reference.
  await page.locator('#figure-edit [name=src]').fill('assets/control-revised.png');
  await page.locator('#figure-edit [name=caption]').fill('Revised layout');
  await page.locator('#figure-edit button').click();
  const revised = original.replace('assets/control.png', 'assets/control-revised.png').replace('caption="Control layout"', 'caption="Revised layout"');
  await expect.poll(() => source(page)).toBe(revised);
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  expect(await readFile(file, 'utf8')).toBe(revised);
  const image = page.locator('#content figure img');
  await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(8);
  // Insert a second figure through the form without writing source syntax.
  await page.locator('#figure [name=id]').fill('fig-revised');
  await page.locator('#figure [name=src]').fill('assets/control.png');
  await page.locator('#figure [name=alt]').fill('Second copy');
  await page.locator('#figure button').click();
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  const saved = await readFile(file, 'utf8');
  expect(saved).toContain('@figure id="fig-revised" src="assets/control.png" alt="Second copy"');
  // The ID field is optional: an empty input uses the uniqueness-checked suggestion.
  await page.locator('#figure [name=id]').fill('');
  await page.locator('#figure [name=src]').fill('assets/control-revised.png');
  await page.locator('#figure [name=alt]').fill('Suggested');
  await page.locator('#figure button').click();
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  expect(await readFile(file, 'utf8')).toContain('@figure id="fig-1" src="assets/control-revised.png" alt="Suggested"');
  await page.locator('#reload').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await expect(page.locator('#content figure img')).toHaveCount(3);
  await expect(page.locator('#content figcaption').nth(0)).toHaveText('Figure 1: Revised layout');
  // Export links relative paths, stores no token and renders from file:// under its CSP.
  await page.locator('#export').click();
  await expect(page.getByRole('alert')).toContainText('exported');
  const html = await readFile(file + '.html', 'utf8');
  expect(html).toContain('<img src="assets/control-revised.png"');
  expect(html).not.toContain(server.token);
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(file + '.html').href);
  await expect.poll(() => exported.locator('figure img').first().evaluate(node => node.naturalWidth)).toBe(8);
  await exported.close();
});

test('missing assets show a placeholder with diagnostics and recover through the form', async ({ page }) => {
  const broken = original.replace('assets/control.png', 'assets/missing.png');
  await writeFile(file, broken); await page.locator('#reload').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await expect(page.locator('#content .missing-asset')).toHaveText('Image unavailable: assets/missing.png');
  await expect(page.locator('#diagnostics')).toContainText('NARU_ASSET_MISSING');
  await expect(page.locator('#content figure img')).toHaveCount(0);
  await page.locator('#figure-edit [name=src]').fill('assets/control.png');
  await page.locator('#figure-edit button').click();
  await page.locator('#save').click(); await expect(page.locator('#state')).toHaveText('Saved');
  await expect(page.locator('#content figure img')).toHaveCount(1);
  expect(await readFile(file, 'utf8')).toBe(original);
});
