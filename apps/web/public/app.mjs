import { SourceSession, mountDocument } from '@naruforge/narudoc-editor-adapter';
import { outline, validateDocument } from '@naruforge/narudoc-core';
import { renderBlockHtml } from '@naruforge/narudoc-renderer-html';

const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('narudoc-token');
if (location.hash) { sessionStorage.setItem('narudoc-token', token); history.replaceState(null, '', '/'); }
let session, editors = [], savedSource = '', savedRevision = '', busy = false;
const report = message => { $('message').textContent = message; };
const dirty = () => session && (session.source !== savedSource || session.drafts.size > 0);
async function api(route, input) {
  const response = await fetch('/api/' + route, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Error(`${result.code ?? 'Request failed'}: ${result.message}${result.latestRevision ? '\nLatest disk revision: ' + result.latestRevision : ''}`);
  return result;
}
function update() {
  if (!session) return;
  $('state').textContent = busy ? 'Working…' : session.drafts.size ? 'Unsaved invalid draft' : dirty() ? 'Unsaved changes' : 'Saved';
  $('save').disabled = busy || !session.valid;
  $('export').disabled = busy || !session.valid;
  $('reload').disabled = busy;
  $('content').inert = busy;
  document.querySelectorAll('form input,form select,form button,#section').forEach(e => { e.disabled = busy || !session.valid; });
  const diagnostics = validateDocument(session.snapshot).map(d => `${d.severity} · ${d.code}: ${d.message}`);
  for (const draft of session.drafts.keys()) diagnostics.push('Uncommitted or invalid draft: ' + draft);
  $('diagnostics').replaceChildren(...(diagnostics.length ? diagnostics : ['No validation errors']).map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
function project() {
  editors.forEach(e => e.destroy());
  if (validateDocument(session.snapshot).some(d => d.severity === 'error')) {
    editors = []; $('content').replaceChildren();
    for (const block of session.snapshot.blocks) {
      const wrapper = document.createElement('div'); wrapper.className = 'readonly-block';
      if (block.type === 'metadata') { const pre = document.createElement('pre'); pre.textContent = session.source.slice(block.range.start, block.range.end); wrapper.append(pre); }
      else wrapper.innerHTML = renderBlockHtml(block);
      $('content').append(wrapper);
    }
    $('content').onclick = event => { if (event.target.closest('a')) event.preventDefault(); };
  } else { $('content').onclick = null; editors = mountDocument($('content'), session, report); }
  const selected = $('section').value;
  const items = outline(session.snapshot);
  $('outline').replaceChildren(); $('section').replaceChildren();
  for (const item of items) {
    const button = document.createElement('button'); button.textContent = item.title + (item.id ? '' : ' (read only: missing ID)');
    button.addEventListener('click', () => {
      if (item.id) $('section').value = item.id;
      const heading = [...$('content').children].filter(el => /^H[1-6]$/.test(el.tagName))[items.indexOf(item)];
      heading?.scrollIntoView({ block: 'center' });
    }); $('outline').append(button);
    if (item.id) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; $('section').append(option); }
  }
  if ([...$('section').options].some(o => o.value === selected)) $('section').value = selected;
  const directiveId = $('directive-id').value; $('directive-id').replaceChildren();
  for (const block of session.snapshot.blocks) if (block.type === 'directive' && block.id) {
    const option = document.createElement('option'); option.value = block.id; option.textContent = `${block.name} · ${block.id}`; $('directive-id').append(option);
  }
  if ([...$('directive-id').options].some(o => o.value === directiveId)) $('directive-id').value = directiveId;
  update();
}
function replace(source, rev) {
  session?.listeners.delete(update);
  session = new SourceSession(source); session.listeners.add(update);
  savedSource = source; savedRevision = rev; project();
}
async function run(task) {
  busy = true; update(); report('');
  try { await task(); } catch (error) { report(error.message); }
  finally { busy = false; update(); }
}
$('save').addEventListener('click', () => run(async () => {
  if (!session.valid) throw Error('Resolve the draft before saving.');
  const result = await api('save', { revision: savedRevision, operations: session.operations });
  if (result.source !== session.source) throw Error('Server/client source mismatch. Draft retained; reload after checking disk.');
  replace(result.source, result.revision); report('Saved.');
}));
$('reload').addEventListener('click', () => {
  if (dirty() && !confirm('Discard the unsaved draft and reload from disk?')) return;
  void run(async () => { const result = await api('document'); $('file').textContent = result.file; replace(result.source, result.revision); });
});
$('export').addEventListener('click', () => run(async () => {
  const result = await api('export', { revision: savedRevision, operations: session.operations });
  report('HTML exported without overwriting existing files: ' + result.output);
}));
function form(id, operation) {
  $(id).addEventListener('submit', event => {
    event.preventDefault(); if (busy || !session.valid) return;
    try {
      session.apply(operation(Object.fromEntries(new FormData(event.currentTarget)), $('section').value));
      project(); report('Added to draft. Save to write the file.');
    } catch (error) { report(error.message); }
  });
}
form('child', (v, parent) => ({ type: 'insertChildSection', parent, id: v.id, title: v.title }));
form('paragraph', (v, id) => ({ type: 'insertParagraph', id, index: Number(v.index), text: v.text }));
form('directive', (v, sectionId) => ({ type: 'insertDirective', sectionId, name: v.name, id: v.id, attributes: {}, children: [{ type: 'paragraph', text: v.text }] }));
form('attribute', v => ({ type: 'setDirectiveAttribute', id: v.id, key: v.key, value: v.value }));
addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
// Read-only observation hooks for reproducible browser tests; no alternate save path.
Object.defineProperty(window, 'narudoc', { value: { get session() { return session; }, get editors() { return editors; } } });
void run(async () => { const result = await api('document'); $('file').textContent = result.file; replace(result.source, result.revision); });

