import { SourceSession, mountDocument, undo, redo } from '@naruforge/narudoc-editor-adapter';
import initial from '../../examples/visual-fidelity.narudoc';
let session, editors, active;
const host = document.querySelector('#editor'), diagnostic = document.querySelector('#diagnostic');
function mount(source) {
  for (const editor of editors ?? []) editor.destroy();
  session = new SourceSession(source);
  editors = mountDocument(host, session, message => { diagnostic.textContent = message; });
  active = editors[0];
  for (const editor of editors) editor.view.dom.addEventListener('focus', () => { active = editor; });
  session.listeners.add(() => {
    document.querySelector('#source').textContent = session.source;
    document.querySelector('#status').textContent = session.drafts.size ? 'Draft needs attention' : session.source === source ? 'Unchanged' : 'Changed in memory';
  });
  diagnostic.textContent = ''; session.notify();
}
document.querySelector('#undo').onclick = () => active && undo(active.view.state, active.view.dispatch);
document.querySelector('#redo').onclick = () => active && redo(active.view.state, active.view.dispatch);
mount(initial);
// In-memory spike harness API for deterministic parity/fidelity tests; no persistence endpoint.
window.spike = { get session() { return session; }, get editors() { return editors; }, mount };
