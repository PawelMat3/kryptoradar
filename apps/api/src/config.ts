import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = (k: string, d = '') => process.env[k]?.trim() || d;

export type Mode = 'demo' | 'live';

const hostOf = (u: string) => {
  try {
    return u ? new URL(u).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
};

export const config = {
  version: '0.1.0',
  port: Number(env('PORT', '3000')),
  /** Demo jest zawsze dostępne; analizy live tylko gdy RADAR_LIVE_ENABLED=true. */
  liveEnabled: env('RADAR_LIVE_ENABLED', 'false') === 'true',
  databaseUrl: env('DATABASE_URL', 'postgres://radar:radar@localhost:5432/radar'),
  dataDir: env('RADAR_DATA_DIR', join(here, '..', 'data')),
  workerUrl: env('OSINT_WORKER_URL', 'http://localhost:8000'),
  demoSearchUrl: env('DEMO_SEARCH_URL', 'http://search.test'),
  mockAdminUrl: env('MOCK_ADMIN_URL', 'http://mock-osint'),
  searxngUrl: env('SEARXNG_URL'),
  // Lista dozwolonych hostów + hosty usług skonfigurowanych przez administratora (SearXNG, Blockscout, mempool).
  egressAllowlist: [
    ...env('EGRESS_ALLOWLIST', '*.test,localhost,127.0.0.1,osint-worker,mock-osint').split(','),
    hostOf(env('SEARXNG_URL')),
    hostOf(env('BLOCKSCOUT_URL')),
    hostOf(env('MEMPOOL_URL')),
  ]
    .map((s) => s.trim().toLowerCase())
    .filter((s, i, a) => s && a.indexOf(s) === i),
  /** Pozwala pobierać strony WWW (np. z wyników wyszukiwarki) z dowolnego publicznego hosta. API blockchain nadal tylko z listy. */
  openWeb: env('EGRESS_OPEN_WEB', 'false') === 'true',
  userAgent: env('RADAR_USER_AGENT', 'KryptoRadar/0.1 (OSINT; public sources only)'),
  fetch: {
    timeoutMs: Number(env('FETCH_TIMEOUT_MS', '15000')),
    maxBytes: Number(env('FETCH_MAX_BYTES', String(2 * 1024 * 1024))),
    perHostDelayMs: Number(env('FETCH_PER_HOST_DELAY_MS', '300')),
    maxPages: Number(env('FETCH_MAX_PAGES', '40')),
  },
  llm: {
    baseUrl: env('LLM_BASE_URL'),
    model: env('LLM_MODEL', 'qwen2.5:3b'),
    apiKey: env('LLM_API_KEY'),
  },
};
