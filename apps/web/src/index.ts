import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { NaruError } from '@naruforge/narudoc-model';
import { assertValid, parseDocument, planBatch, validateDocument } from '@naruforge/narudoc-core';
import { renderHtml } from '@naruforge/narudoc-renderer-html';
import { load, save, createFile, decode, assertDocumentSize, revision } from '@naruforge/narudoc-file-store';

const LIMIT = 10 * 1024 * 1024;
const assets: Record<string, [string, string]> = {
  '/': ['../public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['./app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['../public/style.css', 'text/css; charset=utf-8'],
};
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type'] !== 'application/json') throw new NaruError('NARU_ARGUMENT', 'Expected application/json.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw new NaruError('NARU_LIMIT', 'Request exceeds 10 MiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(decode(Buffer.concat(chunks))); }
  catch (error) { if (error instanceof NaruError) throw error; throw new NaruError('NARU_ARGUMENT', 'Invalid JSON.'); }
}
function request(value: unknown): { revision: string; operations: unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NaruError('NARU_ARGUMENT', 'Expected revision and operations.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision) || !Array.isArray(v.operations) || v.operations.length > 10000) throw new NaruError('NARU_ARGUMENT', 'Expected revision and at most 10000 operations.');
  return { revision: v.revision, operations: v.operations };
}
/** One explicit file, one random authenticated session. All persistence uses the CLI's shared store. */
export async function startEditor(file: string, port = 0) {
  const path = resolve(file);
  await load(path);
  const token = randomBytes(32).toString('hex');
  let origin = '';
  const server = createServer((req, res) => { void handle(req, res); });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) { json(403, { message: 'Host or Origin rejected.' }); return; }
      const route = req.url ?? '';
      if (req.method === 'GET' && Object.hasOwn(assets, route)) {
        const [asset, type] = assets[route]!;
        res.setHeader('Content-Type', type); res.end(await readFile(new URL(asset, import.meta.url))); return;
      }
      if (!['/api/document', '/api/save', '/api/export'].includes(route)) { json(404, { message: 'Unknown route.' }); return; }
      if (req.headers.authorization !== `Bearer ${token}` || (req.method !== 'GET' && req.headers.origin !== origin)) { json(403, { message: 'Session or Origin rejected.' }); return; }
      if (route === '/api/document' && req.method === 'GET') {
        const current = await load(path);
        json(200, { file: path, source: current.source, revision: current.revision, diagnostics: validateDocument(parseDocument(current.source)) }); return;
      }
      if (req.method !== 'POST' || route === '/api/document') { json(405, { message: 'Method not allowed.' }); return; }
      const input = request(await body(req));
      const current = await load(path);
      if (input.revision !== current.revision) { json(409, { code: 'NARU_STALE', message: 'File changed. Draft retained; reload only when ready to discard it.', latestRevision: current.revision }); return; }
      let next = parseDocument(current.source); assertValid(next);
      // Each Core batch is sequential; persistence occurs once only after every batch succeeds.
      for (let i = 0; i < input.operations.length; i += 100) next = planBatch(next, { schemaVersion: 1, operations: input.operations.slice(i, i + 100) }).next;
      assertDocumentSize(next.source);
      if (route === '/api/save') {
        await save(current, next.source);
        json(200, { source: next.source, revision: revision(next.source) });
      } else {
        const html = renderHtml(next); const output = path + '.html';
        await createFile(output, html);
        json(200, { output, html });
      }
    } catch (error) {
      const e = error as Error & { code?: string };
      const status = e.code === 'NARU_STALE' || e.code === 'NARU_LOCKED' ? 409 : e instanceof NaruError ? 400 : 500;
      let latestRevision: string | undefined;
      if (e.code === 'NARU_STALE') latestRevision = await load(path).then(s => s.revision).catch(() => undefined);
      json(status, { code: e.code ?? 'NARU_IO', message: e.message, latestRevision });
    }
  }
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => { server.removeListener('error', fail); ok(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing server address');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, origin, token, url: `${origin}/#${token}`, close: () => new Promise<void>((ok, fail) => { server.close(error => error ? fail(error) : ok()); server.closeAllConnections(); }) };
}
export function openBrowser(url: string): void {
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => { process.stderr.write('Browser launch unavailable; open the printed URL.\n'); }); child.unref();
}
