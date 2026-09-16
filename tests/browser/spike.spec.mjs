import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { planOperation, parseDocument } from '../../packages/core/dist/index.js';
const original = await readFile(new URL('../../examples/visual-fidelity.narudoc', import.meta.url),'utf8');
const box = page => page.getByRole('textbox',{name:'paragraph control 0',exact:true});
async function selectText(page, text) {
  const target = box(page), value = await target.textContent();
  const offset = value.indexOf(text);
  expect(offset).toBeGreaterThanOrEqual(0);
  await target.focus();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < text.length; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe(text);
}
const source = page => page.evaluate(()=>window.spike.session.source);
test.beforeEach(async({page})=>{await page.goto('/');await expect(box(page)).toBeVisible();});
test('no-op focus/selection, typing, undo/redo, API parity and screenshot',async({page})=>{
  await selectText(page,'400');expect(await source(page)).toBe(original);
  await page.keyboard.type('420');
  await expect.poll(()=>source(page)).toBe(original.replace('400','420'));
  const api=planOperation(parseDocument(original),{type:'setInlineText',kind:'paragraph',id:'control',index:0,path:'2',expected:' is 400 V. See ',text:' is 420 V. See '});
  expect(await source(page)).toBe(api.next.source);
  await page.keyboard.press('Control+z');await expect.poll(()=>source(page)).toBe(original);
  await page.keyboard.press('Control+y');await expect.poll(()=>source(page)).toBe(api.next.source);
  await page.screenshot({path:process.env.CI ? 'test-results/26-adapter.png' : 'docs/evidence/26-adapter.png',fullPage:true});
});
test('delete, plain paste, Korean synthetic composition and supplementary Unicode',async({page})=>{
  await selectText(page,'400');await page.keyboard.press('Backspace');await expect.poll(()=>source(page)).toBe(original.replace('400',''));
  await page.keyboard.insertText('400');await expect.poll(()=>source(page)).toBe(original);
  await selectText(page,'400');
  await box(page).evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','420');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await expect.poll(()=>source(page)).toBe(original.replace('400','420'));
  await selectText(page,'420');
  await box(page).dispatchEvent('compositionstart',{data:''});
  await page.keyboard.insertText('한글😀');
  expect(await source(page)).toBe(original.replace('400','420'));
  await box(page).dispatchEvent('compositionend',{data:'한글😀'});
  await expect.poll(()=>source(page)).toBe(original.replace('400','한글😀'));
});
test('heading and directive ordinary typing preserves source spacing and siblings',async({page})=>{
  const heading=page.getByRole('textbox',{name:'heading control 0',exact:true});
  await heading.focus();await page.keyboard.press('End');await page.keyboard.type(' design');
  await expect.poll(()=>source(page)).toBe(original.replace('Control  {#control}','Control design  {#control}'));
  const directive=page.getByRole('textbox',{name:'directiveParagraph REQ-001 0',exact:true});
  await directive.focus();await page.keyboard.press('End');await page.keyboard.insertText(' 한글😀');
  await expect.poll(()=>source(page)).toBe(original.replace('Control  {#control}','Control design  {#control}').replace('validate its inputs.','validate its inputs. 한글😀'));
});
test('invalid draft and protected structure preserve canonical source',async({page})=>{
  await selectText(page,'400');await page.keyboard.insertText('**changed**');
  await expect(page.getByRole('alert')).not.toBeEmpty();expect(await source(page)).toBe(original);
  expect(await box(page).textContent()).toContain('**changed**');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>source(page)).toBe(original);
  await expect(page.locator('table')).toContainText('50');
  expect(await page.evaluate(()=>window.documentExecuted)).toBeUndefined();
  await box(page).focus();await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');
  expect(await source(page)).toBe(original);await expect(page.getByRole('alert')).not.toBeEmpty();
});
test('BOM/EOL/EOF no-op and stale mapping draft retention',async({page})=>{
  for(const eol of ['\r\n','\r','\n','mixed']) {
    let count=0;
    const fixture='\uFEFF'+(eol==='mixed' ? original.trimEnd().replace(/\n/g,()=>['\r\n','\r','\n'][count++%3]) : original.trimEnd().replaceAll('\n',eol));
    await page.evaluate(s=>window.spike.mount(s),fixture);await selectText(page,'400');expect(await source(page)).toBe(fixture);
    await page.keyboard.type('420');await expect.poll(()=>source(page)).toBe(fixture.replace('400','420'));
  }
  await page.evaluate(s=>window.spike.mount(s),original);
  await selectText(page,'400');await box(page).dispatchEvent('compositionstart',{data:''});await page.keyboard.insertText('draft');
  await page.evaluate(()=>window.spike.session.replace(window.spike.session.source.replace('400','430')));
  await box(page).dispatchEvent('compositionend',{data:'draft'});
  await expect(page.getByRole('alert')).toContainText(/stale/i);expect(await source(page)).toBe(original.replace('400','430'));expect(await box(page).textContent()).toContain('draft');
});
test('external replacement invalidates even unchanged block mappings',async({page})=>{
  await selectText(page,'400');
  await page.evaluate(()=>window.spike.session.replace(window.spike.session.source.replace('Keep this','Keep that')));
  await page.keyboard.type('420');
  await expect(page.getByRole('alert')).toContainText(/stale/i);
  expect(await source(page)).toBe(original.replace('Keep this','Keep that'));
  expect(await box(page).textContent()).toContain('420');
});
test('whole ordinary run deletion and undo/redo restore exact source',async({page})=>{
  const fixture='# H {#h}\n\nA **bold** B';
  await page.evaluate(s=>window.spike.mount(s),fixture);
  await page.evaluate(()=> {const e=window.spike.editors[1];e.view.focus();e.view.dispatch(e.view.state.tr.delete(1,3));});
  await expect.poll(()=>source(page)).toBe('# H {#h}\n\n**bold** B');
  await page.keyboard.press('Control+z');await expect.poll(()=>source(page)).toBe(fixture);
  await page.keyboard.press('Control+y');await expect.poll(()=>source(page)).toBe('# H {#h}\n\n**bold** B');
});
