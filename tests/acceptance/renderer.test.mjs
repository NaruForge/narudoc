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
test('figures render through the caller-provided URL mapping and never read files', async () => {
  const { resolveReferences } = await import('../../packages/core/dist/index.js');
  const doc = parseDocument(String.raw`# D {#d}

See [@fig-a].

@figure id="fig-a" src="assets/pixel.png" alt="A <diagram>" caption="A \"caption\""

@figure id="fig-b" src="assets/gone.png" alt=""
`);
  const context = resolveReferences(doc);
  const html = renderHtml(doc, context, { assetUrl: src => src === 'assets/pixel.png' ? '/mapped/pixel.png' : undefined });
  assert.match(html, /<figure id="fig-a"><img src="\/mapped\/pixel\.png" alt="A &lt;diagram&gt;"><figcaption>Figure 1: A &quot;caption&quot;<\/figcaption><\/figure>/);
  assert.match(html, /<figure id="fig-b"><span class="missing-asset">Image unavailable: assets\/gone\.png<\/span><figcaption>Figure 2<\/figcaption><\/figure>/);
  assert.match(html, /<a href="#fig-a" data-reference="fig-a">Figure 1<\/a>/);
  assert.match(html, /img-src 'self'/, 'figure documents relax only img-src');
  const unmapped = renderHtml(doc, context);
  assert.ok(!unmapped.includes('<img'), 'without a URL mapping every figure is a placeholder');
  assert.match(unmapped, /Image unavailable: assets\/pixel\.png/);
  const figureOnly = parseDocument('# D {#d}\n\n@figure id="f" src="a.png" alt="a"\n');
  assert.throws(() => renderHtml(figureOnly), { code: 'NARU_RENDER_CONTEXT' }, 'figures require their context');
  assert.ok(!renderHtml(parseDocument('# D {#d}\n')).includes("img-src"), 'no figure keeps the strict CSP');
});
test('assetHref encodes segments without decoding literal percent, hash, space or Hangul', async () => {
  const { assetHref } = await import('../../packages/renderer-html/dist/index.js');
  assert.equal(assetHref('assets/pixel.png'), 'assets/pixel.png');
  assert.equal(assetHref('assets/제어 #1 100%.png'), 'assets/%EC%A0%9C%EC%96%B4%20%231%20100%25.png');
});
