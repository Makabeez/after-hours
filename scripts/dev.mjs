// Local preview: serves public/ and the /api routes the same way Vercel does.
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import path from 'node:path';
const root = path.resolve('public'), port = process.env.PORT || 3000;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const mod = await import(path.resolve('api', url.pathname.slice(5) + '.js') + '?t=' + Date.now());
    const shim = { setHeader: (k, v) => res.setHeader(k, v), status: c => ({ json: o => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); } }) };
    return mod.default({ headers: req.headers, query: Object.fromEntries(url.searchParams) }, shim);
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log(`After Hours on http://localhost:${port}`));
