// Odkrywanie źródeł: Maigret (konta po nicku) i wyszukiwarka zgodna z API SearXNG.
import { config, type Mode } from '../config.js';
import { safeJson } from './http.js';
import type { RequestLogEntry } from './chain/types.js';

export interface MaigretHit {
  site: string;
  url: string;
  username: string;
  tags: string[];
  ids: Record<string, string>;
}

export interface MaigretResult {
  username: string;
  checkedSites: number;
  claimed: MaigretHit[];
  maigretVersion: string;
  db: string;
}

export async function maigretSearch(username: string, mode: Mode, log: RequestLogEntry[]): Promise<MaigretResult> {
  const t0 = Date.now();
  const url = `${config.workerUrl}/search`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, mode }),
      signal: AbortSignal.timeout(180_000),
    });
    log.push({ url: `${url} (maigret: ${username})`, status: r.status, at: new Date(t0).toISOString(), ms: Date.now() - t0 });
    if (!r.ok) throw new Error(`osint-worker HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()) as MaigretResult;
  } catch (e) {
    log.push({ url: `${url} (maigret: ${username})`, status: `ERROR ${(e as Error).message}`, at: new Date(t0).toISOString(), ms: Date.now() - t0 });
    throw e;
  }
}

export interface SearchHit {
  url: string;
  title: string;
  content: string;
  query: string;
}

/** Wyszukiwarka w formacie SearXNG (/search?q=…&format=json). W demo – syntetyczny indeks. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

/**
 * Wyszukiwarka w formacie SearXNG (/search?q=…&format=json). W demo – syntetyczny indeks.
 * Filtr trafności: zostają tylko wyniki, których URL, tytuł lub opis zawiera szukany identyfikator
 * (silniki często ignorują cudzysłów i zwracają przypadkowe strony).
 */
export async function webSearch(query: string, mode: Mode, log: RequestLogEntry[], term?: string): Promise<{ hits: SearchHit[]; dropped: number }> {
  const base = mode === 'demo' ? config.demoSearchUrl : config.searxngUrl;
  if (!base) return { hits: [], dropped: 0 };
  const j = await safeJson<{ results?: { url: string; title?: string; content?: string }[] }>(
    `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`,
    log,
  );
  // Wszystkie słowa identyfikatora muszą wystąpić (dowolna kolejność: "Paweł Matuszewski" = "Matuszewski Paweł").
  const words = fold(term ?? query.replace(/"/g, ''))
    .split(/\s+/)
    .filter(Boolean);
  const all = (j.results ?? []).map((r) => ({ url: r.url, title: r.title ?? '', content: r.content ?? '', query }));
  const hay = (r: SearchHit) => {
    let u = r.url;
    try {
      u = decodeURIComponent(r.url);
    } catch {
      /* niepoprawne kodowanie URL */
    }
    return fold(`${u} ${r.title} ${r.content}`);
  };
  const hits = all.filter((r) => words.every((w) => hay(r).includes(w))).slice(0, 10);
  return { hits, dropped: all.length - hits.length };
}
