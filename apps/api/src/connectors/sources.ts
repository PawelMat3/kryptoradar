// Rejestr źródeł Web2 i parsowanie pobranych stron.
// Nowe źródło = wpis w data/sources.json (kategoria, selektory wpisów/autorów) – bez zmian w kodzie.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import type { SourceCategory } from '../core/scoring.js';
import { safeFetch, safeJson } from './http.js';
import type { RequestLogEntry } from './chain/types.js';

export interface SourceDef {
  id: string;
  name: string;
  demo?: boolean;
  match: { host: string };
  category: SourceCategory;
  kind: string;
  adapter?: string;
  nameSelector?: string;
  segments?: { selector: string; author: string; content: string };
  overrides?: { pathPrefix: string; category: SourceCategory }[];
}

export const SOURCES: SourceDef[] = JSON.parse(readFileSync(join(config.dataDir, 'sources.json'), 'utf8'));

export function sourceFor(url: string): { source: SourceDef; category: SourceCategory } {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  // Dokładne dopasowanie hosta (bez dowolnych subdomen: docs.github.com to nie profil GitHub).
  const s = SOURCES.find((x) => host === x.match.host.replace(/^www\./, ''));
  if (!s) {
    return { source: { id: `web:${host}`, name: host, match: { host }, category: 'UNKNOWN_WEB', kind: 'web' }, category: 'UNKNOWN_WEB' };
  }
  const ov = s.overrides?.find((o) => u.pathname.startsWith(o.pathPrefix));
  return { source: s, category: ov?.category ?? s.category };
}

/** Kanoniczny klucz zasobu do deduplikacji. Dla profili GitHub: github.com/{user} (bez ?tab= itp.). */
export function canonicalKey(url: string): string {
  const u = new URL(url);
  const { source } = sourceFor(url);
  if (source.adapter === 'github-api') {
    const user = u.pathname.split('/').filter(Boolean)[0] ?? '';
    return `github:${user.toLowerCase()}`;
  }
  u.hash = '';
  return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + u.search).toLowerCase();
}

const NAV_RE =
  /\/(login|log-in|signin|sign-in|signup|sign-up|join|register|auth|oauth|session|logout|password|terms|tos|privacy|policy|policies|cookies|legal|help|support|about|contact|security|pricing|features|enterprise|explore|discover|trending|marketplace|sponsors|settings|notifications|search|starred|site-policy)(\/|$|\?)/i;

/** Linki nawigacyjne serwisu – nie prowadzą do treści osoby. */
export function isNavigationLink(u: URL): boolean {
  return NAV_RE.test(u.pathname) || /[?&](return_to|redirect|next|client_id)=/i.test(u.search);
}

export interface Segment {
  author: string | null;
  text: string;
  quoted: string[];
}

export interface ParsedPage {
  title: string;
  declaredName: string | null;
  links: string[];
  segments: Segment[];
  fullText: string;
}

export function parsePage(body: string, contentType: string, url: string, source: SourceDef): ParsedPage {
  if (contentType.includes('json') || contentType.startsWith('text/plain')) {
    return { title: url, declaredName: null, links: [], segments: [{ author: null, text: body, quoted: [] }], fullText: body };
  }
  const $ = cheerio.load(body);
  $('script,style,noscript').remove();
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    try {
      links.add(new URL($(el).attr('href')!, url).toString());
    } catch {
      /* pomijamy niepoprawne linki */
    }
  });
  const declaredName = source.nameSelector ? $(source.nameSelector).first().text().trim() || null : null;

  const segments: Segment[] = [];
  const segEls = source.segments ? $(source.segments.selector) : null;
  if (source.segments && segEls && segEls.length) {
    segEls.each((_, el) => {
      const node = $(el);
      const quoted = node.find('blockquote').map((__, q) => $(q).text()).get();
      node.find('blockquote').remove();
      segments.push({
        author: node.find(source.segments!.author).first().text().trim().replace(/^@/, '') || null,
        text: node.find(source.segments!.content).text().replace(/\s+/g, ' ').trim() || node.text().replace(/\s+/g, ' ').trim(),
        quoted,
      });
    });
  } else {
    const quoted = $('blockquote').map((_, q) => $(q).text()).get();
    $('blockquote').remove();
    // Atrybuty linków (href) też niosą adresy, np. "ethereum:0x…" albo linki do eksploratora.
    const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get().join(' ');
    segments.push({ author: null, text: $('body').text().replace(/\s+/g, ' ').trim() + ' ' + hrefs, quoted });
  }
  return {
    title: $('title').text().trim() || url,
    declaredName,
    links: [...links],
    segments,
    fullText: $('body').text().replace(/\s+/g, ' ').trim(),
  };
}

export interface FetchedDoc {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  adapter: string;
}

/** Pobiera źródło – przez dedykowany adapter API (np. GitHub) albo jako stronę HTML. */
export async function fetchSource(url: string, log: RequestLogEntry[]): Promise<FetchedDoc> {
  const { source } = sourceFor(url);
  if (source.adapter === 'github-api') {
    const user = new URL(url).pathname.split('/').filter(Boolean)[0];
    if (user) {
      // Opcjonalny token (tylko odczyt danych publicznych) podnosi limit API z 60 do 5000 zapytań/h.
      const gh: Record<string, string> = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
      const j = await safeJson<Record<string, unknown>>(`https://api.github.com/users/${encodeURIComponent(user)}`, log, { headers: gh });
      url = `https://github.com/${String(j.login ?? user)}`;
      let readme = '';
      try {
        const r = await safeFetch(`https://api.github.com/repos/${user}/${user}/readme`, log, { headers: { accept: 'application/vnd.github.raw', ...gh } });
        if (r.status === 200) readme = r.body;
      } catch {
        /* brak README profilu */
      }
      const body = [
        `<title>GitHub: ${user}</title><body>`,
        `<span itemprop="name">${String(j.name ?? '')}</span>`,
        `<p>bio: ${String(j.bio ?? '')}</p><p>company: ${String(j.company ?? '')}</p>`,
        j.blog ? `<a href="${String(j.blog)}">${String(j.blog)}</a>` : '',
        j.twitter_username ? `<a href="https://x.com/${String(j.twitter_username)}">x</a>` : '',
        `<pre>${readme.replace(/</g, '&lt;')}</pre></body>`,
      ].join('\n');
      return { url, status: 200, contentType: 'text/html', body, bytes: body.length, adapter: 'github-api' };
    }
  }
  const r = await safeFetch(url, log, { respectRobots: true, openWeb: true });
  return { url: r.url, status: r.status, contentType: r.contentType, body: r.body, bytes: r.bytes, adapter: 'html' };
}
