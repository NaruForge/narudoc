import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['dist/app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  const asset = assets[req.url];
  if (req.method !== 'GET' || !asset) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', asset[1]);
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
    res.end(await readFile(new URL('../apps/editor-spike/' + asset[0], import.meta.url)));
  } catch { res.writeHead(500).end('Build the spike first.'); }
});
server.listen(Number(process.env.NARUDOC_SPIKE_PORT ?? 4173), '127.0.0.1', () => console.log('NaruDoc spike: http://127.0.0.1:' + server.address().port));
