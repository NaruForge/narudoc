import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../../packages/core/dist/index.js';
import { renderHtml, safeUrl } from '../../packages/renderer-html/dist/index.js';

test('HTML is deterministic and supports all MVP blocks', () => {
  const source = '---\ntitle: Demo & notes\n---\n# A {#a}\n\nA **strong** and *emphasis* and `code` and [link](#a).\n\n* one\n* two\n\n2. two\n3. three\n\n```js\nconsole.log("hello")\n```\n\n:::note\nid: n\nstatus: draft\n\nBody.\n:::\n';
  const doc = parseDocument(source), html = renderHtml(doc);
  assert.equal(html, renderHtml(doc));
  for (const match of ['<title>Demo &amp; notes</title>', '<h1 id="a">A</h1>', '<strong>strong</strong>', '<em>emphasis</em>', '<code>code</code>', '<ul>', '<ol start="2">', '<aside id="n"', 'Content-Security-Policy']) assert.ok(html.includes(match), match);
});
test('raw HTML, script text and attribute values never execute', () => {
  const source = '---\ntitle: </title><script>bad</script>\n---\n# <img onerror=bad> {#a}\n\n<script>bad</script>\n\n:::note\nid: n\nvalue: "><svg/onload=bad>\n\n<script>bad</script>\n:::\n\n```html\n<script>bad</script>\n```\n';
  const html = renderHtml(parseDocument(source));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<svg')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});
for (const url of ['javascript:alert', 'JAVASCRIPT:bad', 'data:text/html,bad', 'vbscript:bad', 'file:///etc/passwd', '//evil.example', '\\evil', ' https://a', 'java\nscript:bad']) test(`reject URL ${JSON.stringify(url)}`, () => assert.equal(safeUrl(url), false));
for (const url of ['#a', './a.html', '../a.html', 'a.html', 'https://example.com', 'http://localhost', 'mailto:user@example.com']) test(`allow URL ${url}`, () => assert.equal(safeUrl(url), true));
test('unsafe markdown URLs render label without anchor', () => {
  const html = renderHtml(parseDocument('[unsafe](javascript:bad) [safe](https://example.com)'));
  assert.ok(!html.includes('href="javascript:')); assert.ok(html.includes('href="https://example.com"'));
});
