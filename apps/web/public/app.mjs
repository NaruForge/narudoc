import { resolveReferences } from '@naruforge/narudoc-core';
import { SourceSession, mountDocumentProjection } from '@naruforge/narudoc-editor-adapter';
import { outline, validateDocument } from '@naruforge/narudoc-core';
import { renderBlockHtml } from '@naruforge/narudoc-renderer-html';

const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('narudoc-token');
if (location.hash) { sessionStorage.setItem('narudoc-token', token); history.replaceState(null, '', '/'); }
let session, editors = [], documentEditor, busy = false;
let assetUrls = new Map(), assetDiagnostics = [];
const report = message => { $('message').textContent = message; };
const figureUrl = src => assetUrls.get(src);
const dirty = () => session && (session.source !== session.baseSource || session.drafts.size > 0);
async function api(route, input) {
  const response = await fetch('/api/' + route, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Error(`${result.code ?? 'Request failed'}: ${result.message}${result.latestRevision ? '\nLatest disk revision: ' + result.latestRevision : ''}`);
  return result;
}
function update() {
  if (!session) return;
  outline(session.snapshot).forEach((item, index) => {
    const button = $('outline').children[index];
    if (button) button.textContent = item.title + (item.id ? '' : ' (read only: missing ID)');
    const option = [...$('section').options].find(o => o.value === item.id);
    if (option) option.textContent = item.title;
  });
  $('state').textContent = busy ? 'Working…' : session.drafts.size ? 'Unsaved invalid draft' : dirty() ? 'Unsaved changes' : 'Saved';
  $('save').disabled = busy || !session.valid;
  $('export').disabled = busy || !session.valid;
  $('reload').disabled = busy;
  $('content').inert = busy;
  document.querySelectorAll('form input,form select,form button,#section').forEach(e => { e.disabled = busy || !session.valid; });
  const diagnostics = validateDocument(session.snapshot).map(d => `${d.severity} · ${d.code}: ${d.message}`);
  for (const d of assetDiagnostics) diagnostics.push(`error · ${d.code}: ${d.message}`);
  for (const draft of session.drafts.keys()) diagnostics.push('Uncommitted or invalid draft: ' + draft);
  $('diagnostics').replaceChildren(...(diagnostics.length ? diagnostics : ['No validation errors']).map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
function project() {
  documentEditor?.destroy(); documentEditor = undefined; editors = [];
  if (validateDocument(session.snapshot).some(d => d.severity === 'error')) {
    editors = []; $('content').replaceChildren();
    const context = resolveReferences(session.snapshot);
    for (const block of session.snapshot.blocks) {
      const wrapper = document.createElement('div'); wrapper.className = 'readonly-block';
      if (block.type === 'metadata') { const pre = document.createElement('pre'); pre.textContent = session.source.slice(block.range.start, block.range.end); wrapper.append(pre); }
      else wrapper.innerHTML = renderBlockHtml(block, context, { assetUrl: figureUrl });
      // Document IDs belong to the source, not the application's control namespace.
      wrapper.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      $('content').append(wrapper);
    }
    $('content').onclick = event => { if (event.target.closest('a')) event.preventDefault(); };
  } else { $('content').onclick = null; documentEditor = mountDocumentProjection($('content'), session, report, figureUrl); editors = documentEditor.handles; }
  const selected = $('section').value;
  const items = outline(session.snapshot);
  $('outline').replaceChildren(); $('section').replaceChildren();
  for (const item of items) {
    const button = document.createElement('button'); button.textContent = item.title + (item.id ? '' : ' (read only: missing ID)');
    button.addEventListener('click', () => {
      if (item.id) $('section').value = item.id;
      const heading = $('content').querySelectorAll('h1,h2,h3,h4,h5,h6')[items.indexOf(item)];
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
  const figures = session.snapshot.blocks.filter(block => block.type === 'figure');
  const figureId = $('figure-id').value; $('figure-id').replaceChildren();
  for (const block of figures) {
    const option = document.createElement('option'); option.value = block.id; option.textContent = `${block.id} · ${block.src}`; $('figure-id').append(option);
  }
  if ([...$('figure-id').options].some(o => o.value === figureId)) $('figure-id').value = figureId;
  $('figure-edit').hidden = !figures.length;
  const selectedFigure = figures.find(block => block.id === $('figure-id').value);
  if (selectedFigure && document.activeElement?.closest('#figure-edit') !== $('figure-edit')) {
    $('figure-edit').elements.src.value = selectedFigure.src;
    $('figure-edit').elements.alt.value = selectedFigure.alt;
    $('figure-edit').elements.caption.value = selectedFigure.caption ?? '';
  }
  const idInput = $('figure').elements.id;
  if (!idInput.value) {
    const used = new Set(session.snapshot.blocks.flatMap(block => 'id' in block && block.id ? [block.id] : []));
    let n = 1; while (used.has(`fig-${n}`)) n++;
    idInput.placeholder = `Suggestion: fig-${n}`;
  }
  update();
}
function replace(source, rev) {
  session?.listeners.delete(update);
  session = new SourceSession(source, { revision: rev, historyLimit: 200 }); session.listeners.add(update);
  project();
}
async function run(task) {
  busy = true; update(); report('');
  try { await task(); } catch (error) { report(error.message); }
  finally { busy = false; update(); }
}
$('save').addEventListener('click', () => run(async () => {
  if (!session.valid) throw Error('Resolve the draft before saving.');
  const result = await api('save', { revision: session.diskRevision, operations: session.operations });
  if (result.source !== session.source) throw Error('Server/client source mismatch. Draft retained; reload after checking disk.');
  session.acknowledgeSave(result.source, result.revision);
  const fresh = await api('document');
  assetUrls = new Map((fresh.figures ?? []).filter(figure => figure.url).map(figure => [figure.src, figure.url]));
  assetDiagnostics = fresh.assetDiagnostics ?? [];
  project(); report('Saved.');
}));
$('undo').addEventListener('click', () => run(async () => { if (!session.undoGesture()) report('Nothing to undo.'); }));
$('redo').addEventListener('click', () => run(async () => { if (!session.redoGesture()) report('Nothing to redo.'); }));
$('reload').addEventListener('click', () => {
  if (dirty() && !confirm('Discard the unsaved draft and reload from disk?')) return;
  void run(async () => {
    const result = await api('document');
    assetUrls = new Map((result.figures ?? []).filter(figure => figure.url).map(figure => [figure.src, figure.url]));
    assetDiagnostics = result.assetDiagnostics ?? [];
    $('file').textContent = result.file; replace(result.source, result.revision);
  });
});
$('export').addEventListener('click', () => run(async () => {
  const result = await api('export', { revision: session.diskRevision, operations: session.operations });
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
form('figure', (v, sectionId) => ({ type: 'insertFigure', sectionId, id: v.id, src: v.src, alt: v.alt, ...(v.caption ? { caption: v.caption } : {}) }));
form('figure-edit', v => ({ type: 'setFigureMetadata', id: v.id, src: v.src, alt: v.alt, caption: v.caption }));
addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
// Read-only observation hooks for reproducible browser tests; no alternate save path.
Object.defineProperty(window, 'narudoc', { value: { get session() { return session; }, get editors() { return editors; } } });
void run(async () => {
  const result = await api('document');
  assetUrls = new Map((result.figures ?? []).filter(figure => figure.url).map(figure => [figure.src, figure.url]));
  assetDiagnostics = result.assetDiagnostics ?? [];
  $('file').textContent = result.file; replace(result.source, result.revision);
});
