import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseInline } from '../../packages/parser/dist/index.js';

const text = value => ({ type: 'text', value });
const link = (label, url) => ({ type: 'link', url, children: [text(label)] });

test('link scanning preserves the limited dialect and resumes after malformed candidates', () => {
  const cases = [
    ['[label](https://example.com)', [link('label', 'https://example.com')]],
    ['[[label](#id)', [link('[label', '#id')]],
    ['[](url) [ok](#id)', [text('[](url) '), link('ok', '#id')]],
    ['[bad](has space) [ok](#id)', [text('[bad](has space) '), link('ok', '#id')]],
    ['[bad]( [ok](#id)', [text('[bad]( '), link('ok', '#id')]],
    ['[bad\n[ok](#id)', [text('[bad\n'), link('ok', '#id')]],
    ['[bad\r[ok](#id)', [text('[bad\r'), link('ok', '#id')]],
    ['\\[escaped](url) [ok](#id)', [text('[escaped](url) '), link('ok', '#id')]],
    ['[**label**](url)', [link('**label**', 'url')]],
    ['[a](one)[b](two)', [link('a', 'one'), link('b', 'two')]],
    ['**[ok](#id)**', [{ type: 'strong', children: [link('ok', '#id')] }]],
  ];
  for (const [source, expected] of cases) assert.deepEqual(parseInline(source), expected, source);
});

test('large unmatched link input finishes and remains literal', () => {
  // A separate process lets the deadline stop a synchronous parser regression.
  // The generous limit detects repeated suffix scans, not minor timing changes.
  const parser = new URL('../../packages/parser/dist/index.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { parseInline } from ${JSON.stringify(parser)};
    const brackets = '['.repeat(512 * 1024);
    for (const source of [brackets, brackets + '](bad url)', '[label](' + brackets]) {
      assert.deepEqual(parseInline(source), [{ type: 'text', value: source }]);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
