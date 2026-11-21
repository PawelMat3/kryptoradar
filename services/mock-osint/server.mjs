// Serwer syntetycznych źródeł OSINT. Rozpoznaje serwis po nagłówku Host (aliasy sieci Docker),
// udostępnia wyszukiwarkę w formacie SearXNG oraz przełącznik wersji (demo podmiany adresu).
import http from 'node:http';
import { buildSite, ROBOTS } from './pages.mjs';

let version = 1;
const port = Number(process.env.PORT ?? 80);

const strip = (html) =>
  html
    .replace(/<(style|title|script)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function search(q) {
  const term = q.replace(/"/g, '').trim().toLowerCase();
  if (!term) return [];
  const site = buildSite(version);
  const results = [];
  for (const [host, pages] of Object.entries(site)) {
    for (const [path, html] of Object.entries(pages)) {
      const text = strip(html);
      const i = text.toLowerCase().indexOf(term);
      if (i >= 0) {
        results.push({
          url: `http://${host}${path}`,
          title: (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? host,
          content: text.slice(Math.max(0, i - 80), i + term.length + 80),
          engine: 'demo-index',
        });
      }
    }
  }
  return results;
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (code, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
  };

  if (url.pathname === '/__admin/version') {
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        try {
          version = Number(JSON.parse(b).version) === 2 ? 2 : 1;
        } catch {
          /* ignorujemy */
        }
        send(200, JSON.stringify({ version }), 'application/json');
      });
      return;
    }
    return send(200, JSON.stringify({ version }), 'application/json');
  }
  if (url.pathname === '/health') return send(200, JSON.stringify({ ok: true, version }), 'application/json');
  if (url.pathname === '/robots.txt') return send(200, ROBOTS, 'text/plain');
  if (host === 'search.test' && url.pathname === '/search') {
    return send(200, JSON.stringify({ query: url.searchParams.get('q'), results: search(url.searchParams.get('q') ?? '') }), 'application/json');
  }
  const pages = buildSite(version)[host];
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : '/';
  const page = pages?.[path];
  if (!page) return send(404, '<!doctype html><title>404</title><h1>404 – nie znaleziono</h1>');
  send(200, page);
});

server.listen(port, () => console.log(`mock-osint na porcie ${port}, wersja profilu ${version}`));
