// Jedyny punkt wyjścia do sieci dla API. Wymusza:
//  - listę dozwolonych hostów (wymóg: brak wysyłania danych do niezatwierdzonych usług),
//  - poszanowanie robots.txt dla stron HTML,
//  - limity czasu, rozmiaru i tempa zapytań (etyczny OSINT, brak obciążania serwisów),
//  - dziennik każdego zapytania (odtwarzalność analizy).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import type { RequestLogEntry } from './chain/types.js';

export class EgressDeniedError extends Error {}

export function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return config.egressAllowlist.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) || h === p.slice(2) : h === p));
}

const lastHit = new Map<string, number>();
async function throttle(host: string) {
  const wait = (lastHit.get(host) ?? 0) + config.fetch.perHostDelayMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

const robotsCache = new Map<string, string[]>();
async function disallowedPaths(origin: string): Promise<string[]> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  let rules: string[] = [];
  try {
    const r = await fetch(origin + '/robots.txt', { headers: { 'user-agent': config.userAgent }, signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      let applies = false;
      for (const line of (await r.text()).split('\n')) {
        const [k, ...v] = line.split(':');
        const key = k.trim().toLowerCase();
        const val = v.join(':').trim();
        if (key === 'user-agent') applies = val === '*' || val.toLowerCase().includes('kryptoradar');
        else if (applies && key === 'disallow' && val) rules.push(val);
      }
    }
  } catch {
    rules = [];
  }
  robotsCache.set(origin, rules);
  return rules;
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
}

// ---- Tryb "otwartej sieci" (EGRESS_OPEN_WEB) z ochroną przed SSRF ----
// Gdy włączony, strony WWW (np. z wyników wyszukiwarki) można pobierać z dowolnego PUBLICZNEGO hosta.
// Adresy prywatne, pętla zwrotna, link-local (metadane chmury) i nazwy wewnętrzne są zawsze blokowane.
export function isPrivateIp(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l.includes(':')) {
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const [a, b] = l.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function isPublicHost(host: string): Promise<boolean> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(h)) return !isPrivateIp(h);
  if (!h.includes('.') || /\.(test|local|internal|localhost|lan|home)$/.test(h)) return false;
  try {
    const addrs = await lookup(h, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

async function checkHost(u: URL, openWeb: boolean): Promise<string | null> {
  if (hostAllowed(u.hostname)) return null;
  if (openWeb && config.openWeb) return (await isPublicHost(u.hostname)) ? null : `Host ${u.hostname} nie jest publiczny (ochrona SSRF)`;
  return `Host ${u.hostname} nie jest na liście dozwolonych (EGRESS_ALLOWLIST)`;
}

export async function safeFetch(
  url: string,
  log: RequestLogEntry[],
  opts: { respectRobots?: boolean; headers?: Record<string, string>; method?: string; body?: string; openWeb?: boolean } = {},
): Promise<SafeResponse> {
  let current = new URL(url);
  const t0 = Date.now();
  // Przekierowania obsługujemy ręcznie, żeby każdy kolejny host przeszedł tę samą kontrolę.
  for (let hop = 0; hop < 5; hop++) {
    if (!['http:', 'https:'].includes(current.protocol)) throw new EgressDeniedError(`Niedozwolony protokół: ${current.protocol}`);
    const denied = await checkHost(current, !!opts.openWeb);
    if (denied) {
      log.push({ url: current.toString(), status: `BLOCKED (${denied})`, at: new Date().toISOString(), ms: 0 });
      throw new EgressDeniedError(denied);
    }
    if (opts.respectRobots) {
      const dis = await disallowedPaths(current.origin);
      if (dis.some((p) => current.pathname.startsWith(p))) {
        log.push({ url: current.toString(), status: 'SKIPPED (robots.txt)', at: new Date().toISOString(), ms: 0 });
        throw new EgressDeniedError(`robots.txt zabrania pobrania ${current.pathname}`);
      }
    }
    await throttle(current.hostname);
    const ts = Date.now();
    try {
      const r = await fetch(current, {
        method: hop === 0 ? (opts.method ?? 'GET') : 'GET',
        body: hop === 0 ? opts.body : undefined,
        headers: { 'user-agent': config.userAgent, accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...opts.headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.fetch.timeoutMs),
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        log.push({ url: current.toString(), status: `${r.status} → ${r.headers.get('location')}`, at: new Date(ts).toISOString(), ms: Date.now() - ts });
        current = new URL(r.headers.get('location')!, current);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const body = buf.subarray(0, config.fetch.maxBytes).toString('utf8');
      log.push({ url: current.toString(), status: r.status, at: new Date(ts).toISOString(), ms: Date.now() - ts });
      return { url: current.toString(), status: r.status, contentType: r.headers.get('content-type') ?? '', body, bytes: buf.length };
    } catch (e) {
      if (!(e instanceof EgressDeniedError)) log.push({ url: current.toString(), status: `ERROR ${(e as Error).message}`, at: new Date(ts).toISOString(), ms: Date.now() - t0 });
      throw e;
    }
  }
  throw new EgressDeniedError('Zbyt wiele przekierowań');
}

export async function safeJson<T>(url: string, log: RequestLogEntry[], opts: Parameters<typeof safeFetch>[2] = {}): Promise<T> {
  const r = await safeFetch(url, log, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} dla ${url}`);
  return JSON.parse(r.body) as T;
}
