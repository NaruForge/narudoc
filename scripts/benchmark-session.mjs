import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SourceSession } from '../packages/editor-adapter/dist/session.js';
import { parseDocument, planSequence, validateDocument } from '../packages/core/dist/index.js';

// Public invented data, fixed workload, warmup excluded. Report measurements, never a CI timing threshold.
export function measureSession(source, count, coalesce, Session = SourceSession) {
  const session = new Session(source, { coalesce, historyLimit: 0 });
  let previous = 'Value 0'; const start = performance.now();
  for (let i = 1; i <= count; i++) {
    const text = 'Value ' + i;
    session.apply({ type: 'setInlineText', kind: 'paragraph', id: 'bench', index: 0, path: '0', expected: previous, text }); previous = text;
  }
  const editMs = performance.now() - start, operations = session.operations, replayStart = performance.now();
  const replay = planSequence(parseDocument(source), operations, { collectSteps: false }).next;
  const replayMs = performance.now() - replayStart;
  if (replay.source !== source.replace('Value 0', 'Value ' + count) || session.source !== replay.source || validateDocument(replay).some(d => d.severity === 'error')) throw Error('Replay/source fidelity failed');
  return { coalesce, sourceBytes: Buffer.byteLength(source), edits: count, operations: operations.length, payloadBytes: Buffer.byteLength(JSON.stringify(operations)), editMs: +editMs.toFixed(2), replayMs: +replayMs.toFixed(2) };
}
const prefix = '\uFEFF# Bench  {#bench}\r\n\r\nValue 0\r\n\r\n';
const representative = prefix + Array.from({ length: 120 }, (_, i) => `## Section ${i} {#s${i}}\r\n\r\nThe **public fictional** controller ${i} uses 한글 😀 and [bench](#bench).\r\n\r\n| Name | Value |\r\n| --- | --- |\r\n| Sample ${i} | 400 |\r\n\r\n`).join('');
measureSession(prefix, 10, false); measureSession(prefix, 10, true);
const samples = [];
const baselinePath = process.argv.indexOf('--baseline');
const baseline = baselinePath >= 0 ? (await import(pathToFileURL(resolve(process.argv[baselinePath + 1], 'packages/editor-adapter/dist/index.js')).href)).SourceSession : null;
for (let repeat = 0; repeat < 3; repeat++) for (const source of [prefix, representative]) {
  if (baseline) samples.push({ repeat, mode: 'baseline', ...measureSession(source, 600, false, baseline) });
  for (const coalesce of [false, true]) samples.push({ repeat, mode: coalesce ? 'compacted' : 'uncompacted', ...measureSession(source, 600, coalesce) });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, warmup: 10, historyLimit: 0, note: 'Paired fixed workload; edit time includes exact-source guarded compaction. No throughput claim beyond these fixtures.', samples }, null, 2));
