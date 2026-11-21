// Potok analizy OSINT. Każdy krok jest zapisywany (status, czas, szczegóły), a każde
// zapytanie sieciowe trafia do dziennika – przebieg można odtworzyć i zweryfikować.
import { createHash, randomUUID } from 'node:crypto';
import { config, type Mode } from '../config.js';
import { q } from '../db/pool.js';
import { extractAddresses, normalizeAddress, parseSingleAddress, type Chain, type ExtractedAddress, type RejectedCandidate } from '../core/addresses/extract.js';
import { subjectTokens, usernameCandidates, type SubjectIdentifiers } from '../core/identifiers.js';
import { assessIdentity, nameConflicts, type Discovery, type ProfileEvidence } from '../core/identity.js';
import {
  EXCLUDING_CATEGORIES,
  scoreAddress,
  scoreOccurrence,
  type AddressScore,
  type Exclusion,
  type ExclusionCategory,
  type IdentityAssessment,
  type Occurrence,
  type OccurrenceScore,
  type SourceCategory,
} from '../core/scoring.js';
import { LabelRegistry, CATEGORY_LABELS, type AddressLabel } from '../core/labels.js';
import { analyzeActivity, type ChainAnalysis } from '../core/cashout.js';
import { diffRuns, type RunDiff } from '../core/diff.js';
import { canonicalKey, fetchSource, isNavigationLink, parsePage, sourceFor, type ParsedPage, type SourceDef } from '../connectors/sources.js';
import { maigretSearch, webSearch } from '../connectors/discovery.js';
import { EgressDeniedError } from '../connectors/http.js';
import { providerFor } from '../connectors/chain/providers.js';
import type { AddressInfo, RequestLogEntry } from '../connectors/chain/types.js';
import { getLlm } from '../ai/llm.js';
import { join } from 'node:path';

export const labels = new LabelRegistry(join(config.dataDir, 'labels'));

interface Step {
  id: string;
  title: string;
  status: 'running' | 'done' | 'warning' | 'error';
  startedAt: string;
  finishedAt?: string;
  detail?: string;
}

interface Artifact {
  id: string;
  /** Kanoniczny klucz zasobu (np. github.com/{user} niezależnie od ?tab=…) – deduplikacja. */
  key: string;
  url: string;
  finalUrl: string;
  source: SourceDef;
  category: SourceCategory;
  discovery: Discovery;
  discoveredVia: string | null;
  retrievedAt: string;
  status: number;
  contentType: string;
  sha256: string;
  bytes: number;
  adapter: string;
  raw: string;
  parsed: ParsedPage;
  meta: { username?: string; maigretSite?: string; searchQuery?: string; linkedFromId?: string };
  /** Profile innych serwisów, które linkują do tej strony. */
  linkedFromIds: string[];
  identity?: IdentityAssessment;
}

interface QueueItem {
  url: string;
  discovery: Discovery;
  via: string | null;
  meta: Artifact['meta'];
  depth: number;
}

type OccWithScore = Occurrence & { occ: OccurrenceScore; address: string; chain: Chain; segmentIndex: number };

export interface Conclusion {
  kind: 'FAKT' | 'OBLICZENIE' | 'WNIOSEK';
  text: string;
  refs?: string[];
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

/** Serwisy, których treść wymaga zalogowania (pomijane w wynikach wyszukiwania i jako URL analityka). */
const LOGIN_WALLED = /(^|\.)(instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|linkedin\.com|tiktok\.com|threads\.net|snapchat\.com)$/i;

const TAG_EXCLUSION_PATTERNS: [RegExp, ExclusionCategory][] = [
  [/tornado|mixer|wasabi|samourai|sinbad/i, 'mixer'],
  [/binance|kraken|coinbase|okx|bybit|kucoin|bitfinex|bitstamp|gemini|huobi|htx|gate\.io|zonda|exchange|hot wallet|cold wallet|deposit/i, 'exchange'],
  [/donat|charity|fundacja|zbi[oó]rka/i, 'charity'],
  [/router|uniswap|sushiswap|1inch|pancake|curve|aave|compound/i, 'defi'],
  [/tether|usd coin|token|erc-?20/i, 'token'],
];

export async function executeRun(runId: string): Promise<void> {
  const [run] = await q<{ id: string; case_id: string; mode: Mode; seq: number }>('SELECT id, case_id, mode, seq FROM runs WHERE id=$1', [runId]);
  const [kase] = await q<{ id: string; name: string; identifiers: SubjectIdentifiers }>('SELECT * FROM cases WHERE id=$1', [run.case_id]);
  const ids: SubjectIdentifiers = {
    fullName: kase.identifiers.fullName ?? '',
    usernames: kase.identifiers.usernames ?? [],
    emails: kase.identifiers.emails ?? [],
    messengers: kase.identifiers.messengers ?? [],
    profileUrls: kase.identifiers.profileUrls ?? [],
    addresses: kase.identifiers.addresses ?? [],
  };
  const mode = run.mode;
  const steps: Step[] = [];
  const log: RequestLogEntry[] = [];
  const versions: Record<string, unknown> = {
    app: config.version,
    scoringModel: 'confidence-v1',
    labelsFiles: labels.files,
    labelsCount: labels.size,
    mode,
  };
  const persistSteps = () => q('UPDATE runs SET steps=$2 WHERE id=$1', [runId, JSON.stringify(steps)]);

  async function step<T>(id: string, title: string, fn: (s: Step) => Promise<T>): Promise<T> {
    const s: Step = { id, title, status: 'running', startedAt: now() };
    steps.push(s);
    await persistSteps();
    try {
      const r = await fn(s);
      if (s.status === 'running') s.status = 'done';
      return r;
    } catch (e) {
      s.status = 'error';
      s.detail = (s.detail ? s.detail + ' | ' : '') + (e as Error).message;
      throw e;
    } finally {
      s.finishedAt = now();
      await persistSteps();
    }
  }

  await q("UPDATE runs SET status='running', started_at=now(), params=$2 WHERE id=$1", [
    runId,
    JSON.stringify({ identifiers: ids, mode, limits: { maxPages: config.fetch.maxPages, perHostDelayMs: config.fetch.perHostDelayMs }, egressAllowlist: config.egressAllowlist }),
  ]);

  try {
    // 1. Dane wejściowe
    const { candidates, inputAddresses } = await step('input', 'Dane wejściowe i normalizacja identyfikatorów', async (s) => {
      const candidates = usernameCandidates(ids);
      const inputAddresses: ExtractedAddress[] = [];
      const bad: string[] = [];
      for (const a of ids.addresses) {
        const p = parseSingleAddress(a);
        if (p) inputAddresses.push(p);
        else if (a.trim()) bad.push(a);
      }
      s.detail = `Nicki do sprawdzenia: ${candidates.map((c) => `${c.username} (${c.origin})`).join(', ') || 'brak'}; adresy wejściowe: ${inputAddresses.length}${bad.length ? `; odrzucone (zła suma kontrolna): ${bad.join(', ')}` : ''}`;
      if (bad.length) s.status = 'warning';
      return { candidates, inputAddresses };
    });

    const queue: QueueItem[] = [];
    const nickPopularity = new Map<string, number>();

    // 2. Maigret
    await step('maigret', 'Wyszukiwanie kont po nicku (Maigret)', async (s) => {
      const parts: string[] = [];
      for (const c of candidates.slice(0, 4)) {
        try {
          const r = await maigretSearch(c.username, mode, log);
          versions.maigret = r.maigretVersion;
          versions.maigretDb = r.db;
          nickPopularity.set(c.username, r.checkedSites ? r.claimed.length / r.checkedSites : 0);
          for (const h of r.claimed) queue.push({ url: h.url, discovery: 'maigret', via: `Maigret: ${h.site} (${c.origin})`, meta: { username: h.username, maigretSite: h.site }, depth: 0 });
          parts.push(`${c.username}: ${r.claimed.length}/${r.checkedSites} serwisów (${r.claimed.map((h) => h.site).join(', ') || '—'})`);
        } catch (e) {
          s.status = 'warning';
          parts.push(`${c.username}: błąd – ${(e as Error).message}`);
        }
      }
      s.detail = parts.join('; ') || 'Brak nicków do wyszukania';
    });

    // 3. Wyszukiwarka + źródła wskazane przez analityka
    await step('search', 'Wyszukiwarka (SearXNG) i źródła wskazane przez analityka', async (s) => {
      const walledInput: string[] = [];
      for (const u of ids.profileUrls.filter((x) => x.trim())) {
        if (LOGIN_WALLED.test(new URL(u.trim()).hostname)) walledInput.push(u.trim());
        else queue.push({ url: u.trim(), discovery: 'analyst', via: 'wskazane przez analityka', meta: {}, depth: 0 });
      }
      if (walledInput.length) {
        s.status = 'warning';
        log.push(...walledInput.map((url) => ({ url, status: 'SKIPPED (serwis wymaga logowania – poza zakresem OSINT)', at: now(), ms: 0 })));
      }
      // W trybie live dodajemy warianty z kontekstem krypto – zawężają wyniki do stron, na których może paść adres.
      const CRYPTO = '(bitcoin OR ethereum OR BTC OR ETH OR USDT OR portfel OR wallet)';
      const live = mode === 'live';
      const queries: { q: string; term: string }[] = [
        ...(ids.fullName ? [{ q: `"${ids.fullName}"`, term: ids.fullName }] : []),
        ...(ids.fullName && live ? [{ q: `"${ids.fullName}" ${CRYPTO}`, term: ids.fullName }] : []),
        ...ids.emails.map((e) => ({ q: live ? `"${e}"` : e, term: e })),
        ...ids.messengers.map((m) => m.replace(/^@/, '')).map((m) => ({ q: live ? `"${m}" ${CRYPTO}` : m, term: m })),
        ...(live ? candidates.filter((c) => !c.origin.includes('e-mail')).map((c) => ({ q: `"${c.username}" ${CRYPTO}`, term: c.username })) : []),
        ...inputAddresses.map((a) => ({ q: a.address, term: a.address })),
      ].filter((x) => x.q);
      let n = 0;
      let walled = 0;
      let dropped = 0;
      for (const { q: query, term } of queries) {
        try {
          const { hits, dropped: d } = await webSearch(query, mode, log, term);
          dropped += d;
          for (const h of hits) {
            // Serwisy wymagające logowania pomijamy – zasady zadania zabraniają pobierania danych zza logowania.
            if (LOGIN_WALLED.test(new URL(h.url).hostname)) {
              walled++;
              continue;
            }
            queue.push({ url: h.url, discovery: 'search', via: `wyszukiwarka: ${query}`, meta: { searchQuery: term }, depth: 0 });
            n++;
          }
        } catch (e) {
          s.status = 'warning';
          s.detail = `Błąd wyszukiwarki: ${(e as Error).message}`;
        }
      }
      s.detail = `${walledInput.length ? `Pominięto URL wymagające logowania: ${walledInput.join(', ')}; ` : ''}${queries.length} zapytań, ${n} wyników do pobrania, ${dropped} odrzuconych przez filtr trafności${walled ? `, ${walled} pominiętych (serwisy wymagające logowania)` : ''}${mode === 'live' && !config.searxngUrl ? ' (SearXNG nieskonfigurowany – pominięto)' : ''}${s.detail ? '; ' + s.detail : ''}`;
    });

    // 4. Pobieranie źródeł z ograniczonym "pivotem" po linkach do znanych serwisów
    const artifacts: Artifact[] = [];
    await step('fetch', 'Pobieranie i archiwizacja źródeł (z pivotem po linkach)', async (s) => {
      const seen = new Set<string>();
      const skipped: string[] = [];
      const rateLimited = new Set<string>();
      const subjectNicksLower = new Set(candidates.map((c) => c.username.toLowerCase()));
      const priority: Record<Discovery, number> = { analyst: 0, maigret: 1, crosslink: 2, pivot: 3, search: 4 };
      while (queue.length && artifacts.length < config.fetch.maxPages) {
        queue.sort((a, b) => priority[a.discovery] - priority[b.discovery] || a.depth - b.depth);
        const item = queue.shift()!;
        let key: string;
        try {
          key = canonicalKey(item.url);
        } catch {
          continue;
        }
        if (seen.has(key)) {
          // Ten sam zasób odkryty inną drogą – zapamiętujemy silniejsze odkrycie.
          // Zbieramy też wszystkie profile, które linkują do tej strony (dowód powiązania).
          const a = artifacts.find((x) => x.key === key);
          if (a && priority[item.discovery] < priority[a.discovery]) a.discovery = item.discovery;
          if (a && item.discovery === 'crosslink' && item.meta.linkedFromId && !a.linkedFromIds.includes(item.meta.linkedFromId)) a.linkedFromIds.push(item.meta.linkedFromId);
          continue;
        }
        seen.add(key);
        const host = new URL(item.url).hostname;
        if (rateLimited.has(host)) {
          skipped.push(`${item.url} (pominięte: ${host} ogranicza liczbę zapytań)`);
          continue;
        }
        try {
          const doc = await fetchSource(item.url, log);
          const { source, category } = sourceFor(doc.url);
          if (doc.status === 429 || doc.status === 403) {
            // Serwis ogranicza zapytania / blokuje automaty – nie ponawiamy w tym przebiegu (etyczny OSINT).
            if (doc.status === 429) rateLimited.add(host);
            skipped.push(`${item.url} (HTTP ${doc.status})`);
            continue;
          }
          if (doc.status >= 400) {
            skipped.push(`${item.url} (HTTP ${doc.status})`);
            continue;
          }
          if (!/text|json|xml/i.test(doc.contentType || 'text/html')) {
            skipped.push(`${item.url} (nieobsługiwany typ treści: ${doc.contentType})`);
            continue;
          }
          // PostgreSQL (text/jsonb) nie przyjmuje bajtu 0x00 – usuwamy go przed parsowaniem, zapisem i haszowaniem.
          doc.body = doc.body.replace(/\u0000/g, '');
          const parsed = parsePage(doc.body, doc.contentType, doc.url, source);
          const art: Artifact = {
            id: randomUUID(),
            key,
            url: item.url,
            finalUrl: doc.url,
            source,
            category,
            discovery: item.discovery,
            discoveredVia: item.via,
            retrievedAt: now(),
            status: doc.status,
            contentType: doc.contentType,
            sha256: sha256(doc.body),
            bytes: doc.bytes,
            adapter: doc.adapter,
            raw: doc.body,
            parsed,
            meta: item.meta,
            linkedFromIds: item.discovery === 'crosslink' && item.meta.linkedFromId ? [item.meta.linkedFromId] : [],
          };
          artifacts.push(art);
          // Strony z wyszukiwarki i strony "pivot" (np. wątki) nie prowadzą dalej – ograniczamy zasięg,
          // żeby nie zebrać profili innych osób z tego samego serwisu.
          if (item.depth >= 2 || item.discovery === 'search' || item.discovery === 'pivot') continue;
          for (const link of parsed.links) {
            let lu: URL;
            try {
              lu = new URL(link);
            } catch {
              continue;
            }
            const target = sourceFor(link).source;
            if (target.id.startsWith('web:') || target.kind === 'archive') continue; // pivot tylko po znanych serwisach
            // Pomijamy nawigację serwisu (logowanie, regulaminy, pomoc, strona główna).
            if (isNavigationLink(lu) || (target.kind === 'profile' && lu.pathname.replace(/\/$/, '') === '')) continue;
            const mentionsSubject = [...subjectNicksLower].some((n) => decodeURIComponent(lu.pathname + lu.search).toLowerCase().includes(n));
            if (target.id === source.id) {
              if (canonicalKey(link) === key) continue;
              // W obrębie serwisu idziemy tylko do wpisów (serwisy z wątkami) albo stron z nickiem osoby w adresie.
              if (!source.segments && !mentionsSubject) continue;
              queue.push({ url: link, discovery: 'pivot', via: `link na stronie ${doc.url}`, meta: { ...item.meta, linkedFromId: art.id }, depth: item.depth + 1 });
            } else {
              queue.push({ url: link, discovery: 'crosslink', via: `link z profilu ${doc.url}`, meta: { linkedFromId: art.id }, depth: item.depth + 1 });
            }
          }
        } catch (e) {
          skipped.push(`${item.url} (${e instanceof EgressDeniedError ? 'zablokowane: ' : ''}${(e as Error).message})`);
        }
      }
      s.detail = `Zarchiwizowano ${artifacts.length} źródeł${skipped.length ? `; pominięto ${skipped.length}: ${skipped.slice(0, 6).join('; ')}` : ''}`;
      if (!artifacts.length) s.status = 'warning';
    });

    // 5. Tożsamość źródeł
    await step('identity', 'Ocena przynależności źródeł do badanej osoby', async (s) => {
      const tokens = subjectTokens(ids);
      const subjectNicks = new Set(candidates.map((c) => c.username.toLowerCase()));
      const byId = new Map(artifacts.map((a) => [a.id, a]));
      const evidence = (a: Artifact, prev: Map<string, number>): ProfileEvidence => {
        const text = (a.parsed.fullText + ' ' + a.parsed.links.join(' ')).toLowerCase();
        const linkers = a.linkedFromIds.map((id) => byId.get(id)).filter((x): x is Artifact => !!x && x.source.id !== a.source.id);
        const linksToSubject = artifacts
          .filter((o) => o.id !== a.id && o.source.id !== a.source.id && a.parsed.links.some((l) => l.replace(/\/$/, '') === o.finalUrl.replace(/\/$/, '')))
          .map((o) => ({ url: o.finalUrl, factor: prev.get(o.id) ?? 0 }));
        const usernameOnPage = a.meta.username ?? null;
        return {
          discovery: a.discovery,
          linkedFrom: linkers.map((l) => ({ url: l.finalUrl, factor: prev.get(l.id) ?? 0 })),
          linksToSubject,
          tokenMatches: tokens.filter((t) => text.includes(t.value)),
          nickPopularity: usernameOnPage ? (nickPopularity.get(usernameOnPage.toLowerCase()) ?? null) : null,
          username: usernameOnPage && subjectNicks.has(usernameOnPage.toLowerCase()) ? usernameOnPage : null,
          conflictingName: nameConflicts(ids.fullName, a.parsed.declaredName) ? a.parsed.declaredName : null,
        };
      };
      let factors = new Map<string, number>();
      // Iterujemy, aż pewność "przejdzie" łańcuchem linków (profil → profil → wątek) i się ustabilizuje.
      for (let pass = 0; pass < 8; pass++) {
        const next = new Map<string, number>();
        for (const a of artifacts) {
          a.identity = assessIdentity(evidence(a, factors));
          // Strona "pivot" (np. wątek forum) dziedziczy pewność po profilu, z którego prowadzi link.
          if (a.discovery === 'pivot' && a.meta.linkedFromId) {
            const parent = factors.get(a.meta.linkedFromId);
            if (parent !== undefined && parent > a.identity.factor) {
              a.identity = { factor: parent, hits: [...a.identity.hits, { rule: 'ID_INHERIT', description: 'Pewność dziedziczona z profilu, który linkuje do tej strony (ten sam serwis)', value: parent, kind: 'base' }] };
            }
          }
          next.set(a.id, a.identity.factor);
        }
        const stable = pass > 0 && [...next].every(([k, v]) => factors.get(k) === v);
        factors = next;
        if (stable) break;
      }
      s.detail = artifacts.map((a) => `${a.source.name}: T=${a.identity!.factor.toFixed(2)}`).join('; ');
    });

    // 6. Ekstrakcja adresów z uwzględnieniem autorstwa wpisów
    const occurrences: OccWithScore[] = [];
    const rejected: (RejectedCandidate & { url: string })[] = [];
    const otherAuthors: { address: string; chain: Chain; author: string; url: string }[] = [];
    const formatInfo = new Map<string, { validation: string; format: string; display: string }>();
    await step('extract', 'Wykrywanie i walidacja adresów kryptowalutowych', async (s) => {
      const subjectNicks = new Set(candidates.map((c) => c.username.toLowerCase()));
      for (const a of artifacts) {
        // Jeśli wpis ma autora, sprawdzamy czy to badana osoba (ochrona przed przypisaniem cudzych adresów z wątku).
        const segs = a.parsed.segments;
        segs.forEach((seg, si) => {
          const parts = [
            { text: seg.text, quoted: false },
            ...seg.quoted.map((t) => ({ text: t, quoted: true })),
          ];
          for (const p of parts) {
            const { found, rejected: rej } = extractAddresses(p.text);
            rejected.push(...rej.map((r) => ({ ...r, url: a.finalUrl })));
            for (const f of found) {
              const k = `${f.chain}:${normalizeAddress(f.chain, f.address)}`;
              if (!formatInfo.has(k)) formatInfo.set(k, { validation: f.validation, format: f.format, display: f.address });
              if (seg.author && !subjectNicks.has(seg.author.toLowerCase())) {
                otherAuthors.push({ address: f.address, chain: f.chain, author: seg.author, url: a.finalUrl });
                continue;
              }
              let identity = a.identity!;
              if (seg.author) {
                // Autor wpisu = nick badanej osoby. Pewność konta: profil tego nicku w tym samym serwisie, jeśli go mamy.
                const account = artifacts.find((x) => x.source.id === a.source.id && x.meta.username?.toLowerCase() === seg.author!.toLowerCase() && x.discovery !== 'pivot');
                const f0 = Math.max(account?.identity?.factor ?? 0, identity.factor, 0.6);
                identity = {
                  factor: f0,
                  hits: [...(account?.identity?.hits ?? identity.hits), { rule: 'ID_AUTHOR_MATCH', description: `Autor wpisu („${seg.author}”) = nick badanej osoby`, value: f0, kind: 'base' }],
                };
              }
              const occ: Occurrence = {
                artifactId: a.id,
                sourceId: a.source.id,
                sourceName: a.source.name,
                url: a.finalUrl,
                category: a.category,
                context: f.context,
                sentence: f.sentence,
                quoted: p.quoted,
                author: seg.author,
                identity,
                retrievedAt: a.retrievedAt,
              };
              // Ten sam adres w tym samym wpisie (np. tekst + link "ethereum:") liczymy raz.
              const addr = normalizeAddress(f.chain, f.address);
              if (occurrences.some((o) => o.artifactId === a.id && o.segmentIndex === si && o.address === addr && o.quoted === p.quoted)) continue;
              occurrences.push({ ...occ, occ: scoreOccurrence(occ), address: normalizeAddress(f.chain, f.address), chain: f.chain, segmentIndex: si });
            }
          }
        });
        // Wykrywanie masowych komentarzy: wiele wpisów różnych autorów z adresami → giveaway.
        const withAddr = segs.filter((x) => extractAddresses(x.text).found.length > 0);
        const authors = new Set(withAddr.map((x) => x.author));
        if (a.category !== 'MASS_COMMENT' && withAddr.length >= 8 && authors.size >= 6) {
          a.category = 'MASS_COMMENT';
          for (const o of occurrences.filter((x) => x.artifactId === a.id)) {
            o.category = 'MASS_COMMENT';
            o.occ = scoreOccurrence(o);
          }
        }
      }
      for (const ia of inputAddresses) {
        const k = `${ia.chain}:${normalizeAddress(ia.chain, ia.address)}`;
        if (!formatInfo.has(k)) formatInfo.set(k, { validation: ia.validation, format: ia.format, display: ia.address });
      }
      const uniq = new Set(occurrences.map((o) => `${o.chain}:${o.address}`));
      s.detail = `${uniq.size} unikalnych adresów przypisywalnych, ${otherAuthors.length} wystąpień u innych autorów (nieprzypisane), ${rejected.length} kandydatów odrzuconych przez sumę kontrolną`;
    });

    // 7. Weryfikacja: etykiety, bytecode, tagi eksploratora
    const allKeys = new Set<string>([...occurrences.map((o) => `${o.chain}:${o.address}`), ...inputAddresses.map((a) => `${a.chain}:${normalizeAddress(a.chain, a.address)}`)]);
    const infoMap = new Map<string, { info: AddressInfo | null; label: AddressLabel | null; exclusion: Exclusion | null; provider: string | null; error?: string }>();
    await step('verify', 'Weryfikacja adresów: etykiety, bytecode, tagi eksploratora', async (s) => {
      let excluded = 0;
      for (const k of allKeys) {
        const [chain, address] = k.split(':') as [Chain, string];
        const display = formatInfo.get(k)?.display ?? address;
        const label = labels.get(chain, address);
        const provider = providerFor(chain, display, mode);
        let info: AddressInfo | null = null;
        let error: string | undefined;
        if (provider) {
          try {
            info = await provider.getInfo(chain, display, log);
          } catch (e) {
            error = (e as Error).message;
          }
        }
        let exclusion: Exclusion | null = null;
        if (label && EXCLUDING_CATEGORIES.includes(label.category)) {
          exclusion = { rule: `EXCL_LABEL_${label.category.toUpperCase()}`, reason: `${CATEGORY_LABELS[label.category]}: ${label.name}`, category: label.category, evidence: `rejestr etykiet (${label.source})` };
        } else if (info?.isContract) {
          exclusion = { rule: 'EXCL_CONTRACT_BYTECODE', reason: 'Adres zawiera kod wykonywalny (bytecode ≠ 0x) – smart kontrakt, nie konto prywatne', category: 'contract', evidence: info.bytecodeEvidence ?? 'isContract=true' };
        } else {
          for (const t of info?.tags ?? []) {
            const hit = TAG_EXCLUSION_PATTERNS.find(([re]) => re.test(t.name + ' ' + (t.category ?? '')));
            if (hit) {
              exclusion = { rule: `EXCL_TAG_${hit[1].toUpperCase()}`, reason: `Oficjalny tag eksploratora: „${t.name}”`, category: hit[1], evidence: t.source };
              break;
            }
          }
        }
        if (exclusion) excluded++;
        infoMap.set(k, { info, label, exclusion, provider: provider?.id ?? null, error });
      }
      s.detail = `Sprawdzono ${allKeys.size} adresów, wykluczono ${excluded} (giełdy, kontrakty, miksery, zbiórki)`;
    });

    // 8. Wstępny wynik → analiza on-chain → wynik końcowy (premia za przepływ między adresami osoby)
    const prelim = new Map<string, AddressScore>();
    const byKey = new Map<string, OccWithScore[]>();
    for (const o of occurrences) (byKey.get(`${o.chain}:${o.address}`) ?? byKey.set(`${o.chain}:${o.address}`, []).get(`${o.chain}:${o.address}`)!).push(o);
    for (const k of allKeys) prelim.set(k, scoreAddress({ occurrences: byKey.get(k) ?? [], exclusion: infoMap.get(k)?.exclusion ?? null, onChainLinks: [] }));

    const chainReports = new Map<string, { analysis: ChainAnalysis; provider: string; retrievedAt: string }>();
    await step('chain', 'Analiza aktywności blockchain i wskaźników wyjścia do fiat', async (s) => {
      const inputKeys = new Set(inputAddresses.map((a) => `${a.chain}:${normalizeAddress(a.chain, a.address)}`));
      const targets = [...allKeys].filter((k) => !infoMap.get(k)?.exclusion && ((prelim.get(k)?.score ?? 0) >= 10 || inputKeys.has(k))).slice(0, 15);
      const notes: string[] = [];
      for (const k of targets) {
        const [chain, address] = k.split(':') as [Chain, string];
        const display = formatInfo.get(k)?.display ?? address;
        const provider = providerFor(chain, display, mode);
        if (!provider) {
          notes.push(`${chain} ${display.slice(0, 10)}…: brak dostawcy danych dla tej sieci`);
          continue;
        }
        try {
          const txs = await provider.getTransactions(chain, display, log);
          chainReports.set(k, { analysis: analyzeActivity(chain, txs, (c, a) => labels.get(c, a)), provider: provider.id, retrievedAt: now() });
        } catch (e) {
          notes.push(`${display.slice(0, 10)}…: ${(e as Error).message}`);
          s.status = 'warning';
        }
      }
      s.detail = `Przeanalizowano ${chainReports.size} adresów${notes.length ? '; ' + notes.join('; ') : ''}`;
    });

    const finalScores = new Map<string, AddressScore>();
    await step('score', 'Wyliczenie Wskaźnika Pewności', async (s) => {
      for (const k of allKeys) {
        const rep = chainReports.get(k);
        const links: { address: string; score: number; txHash: string }[] = [];
        if (rep) {
          for (const f of rep.analysis.flows) {
            if (!f.counterparty) continue;
            const ck = `${k.split(':')[0]}:${normalizeAddress(k.split(':')[0] as Chain, f.counterparty)}`;
            if (ck !== k && prelim.has(ck) && prelim.get(ck)!.status === 'attributed') links.push({ address: f.counterparty, score: prelim.get(ck)!.score, txHash: f.hash });
          }
        }
        finalScores.set(k, scoreAddress({ occurrences: byKey.get(k) ?? [], exclusion: infoMap.get(k)?.exclusion ?? null, onChainLinks: links }));
      }
      const attributed = [...finalScores.values()].filter((x) => x.status === 'attributed');
      s.detail = `Przypisano ${attributed.length} adresów; ≥80%: ${attributed.filter((x) => x.score >= 80).length}, 60–79%: ${attributed.filter((x) => x.score >= 60 && x.score < 80).length}`;
    });

    // 9. Zapis wyników
    await step('persist', 'Zapis dowodów i wyników (proweniencja, SHA-256)', async (s) => {
      for (const a of artifacts) {
        await q(
          `INSERT INTO artifacts(id, run_id, url, final_url, source_id, source_name, category, discovery, discovered_via, retrieved_at, http_status, content_type, content_sha256, bytes, adapter, title, raw, identity, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [a.id, runId, a.url, a.finalUrl, a.source.id, a.source.name, a.category, a.discovery, a.discoveredVia, a.retrievedAt, a.status, a.contentType, a.sha256, a.bytes, a.adapter, a.parsed.title, a.raw, JSON.stringify(a.identity), JSON.stringify({ ...a.meta, declaredName: a.parsed.declaredName, segments: a.parsed.segments.length })],
        );
      }
      for (const k of allKeys) {
        const [chain, address] = k.split(':') as [Chain, string];
        const sc = finalScores.get(k)!;
        const occs = byKey.get(k) ?? [];
        const im = infoMap.get(k);
        const fi = formatInfo.get(k);
        const status = sc.status === 'excluded' ? 'excluded' : occs.length ? 'attributed' : 'no-evidence';
        await q(
          `INSERT INTO findings(run_id, chain, address, status, score, tier, hits, occurrences, exclusion, label, address_info, validation, format) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            runId,
            chain,
            fi?.display ?? address,
            status,
            sc.score,
            sc.tier,
            JSON.stringify(sc.hits),
            JSON.stringify(occs.map((o) => ({ artifactId: o.artifactId, sourceId: o.sourceId, sourceName: o.sourceName, url: o.url, category: o.category, context: o.context, quoted: o.quoted, author: o.author, identity: o.identity, retrievedAt: o.retrievedAt, score: o.occ.score, hits: o.occ.hits }))),
            JSON.stringify(im?.exclusion ?? null),
            JSON.stringify(im?.label ?? null),
            JSON.stringify(im?.info ? { ...im.info, provider: im.provider } : im?.error ? { error: im.error, provider: im.provider } : null),
            fi?.validation ?? null,
            fi?.format ?? null,
          ],
        );
      }
      for (const [k, r] of chainReports) {
        const [chain] = k.split(':');
        await q(`INSERT INTO chain_reports(run_id, chain, address, provider, retrieved_at, metrics, indicators, flows, cash_out_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
          runId,
          chain,
          formatInfo.get(k)?.display ?? k.split(':')[1],
          r.provider,
          r.retrievedAt,
          JSON.stringify(r.analysis.metrics),
          JSON.stringify(r.analysis.indicators),
          JSON.stringify(r.analysis.flows),
          r.analysis.cashOutLevel,
        ]);
      }
      s.detail = `${artifacts.length} źródeł, ${allKeys.size} adresów, ${chainReports.size} raportów on-chain`;
    });

    // 10. Porównanie z poprzednim przebiegiem
    let diff: RunDiff | null = null;
    await step('diff', 'Porównanie z poprzednim przebiegiem', async (s) => {
      const [prev] = await q<{ id: string; seq: number }>("SELECT id, seq FROM runs WHERE case_id=$1 AND seq<$2 AND status='done' ORDER BY seq DESC LIMIT 1", [run.case_id, run.seq]);
      if (!prev) {
        s.detail = 'Pierwszy przebieg sprawy – brak punktu odniesienia';
        return;
      }
      diff = await computeDiff(prev.id, runId);
      s.detail = `Względem przebiegu #${prev.seq}: ${diff.summary}`;
    });

    // 11. Wnioski: rozdzielenie faktów, obliczeń i wniosków do weryfikacji
    const conclusions: Conclusion[] = [];
    const summary = await step('conclusions', 'Wnioski: fakty, obliczenia, hipotezy do weryfikacji', async (s) => {
      const fmtAddr = (k: string) => formatInfo.get(k)?.display ?? k.split(':')[1];
      const ranked = [...finalScores.entries()].sort((a, b) => b[1].score - a[1].score);
      for (const a of artifacts.filter((x) => x.discovery === 'maigret')) {
        conclusions.push({ kind: 'FAKT', text: `Konto „${a.meta.username}” istnieje w serwisie ${a.source.name} (${a.finalUrl}); pobrano ${a.retrievedAt}, SHA-256 ${a.sha256.slice(0, 16)}…`, refs: [a.id] });
      }
      for (const [k, sc] of ranked) {
        for (const o of (byKey.get(k) ?? []).slice(0, 3)) {
          conclusions.push({ kind: 'FAKT', text: `Adres ${k.split(':')[0]} ${fmtAddr(k)} opublikowano w źródle „${o.sourceName}” (${o.url})${o.author ? `, autor wpisu: ${o.author}` : ''}; pobrano ${o.retrievedAt}.`, refs: [o.artifactId] });
        }
        if (sc.status === 'excluded') {
          const ex = infoMap.get(k)!.exclusion!;
          conclusions.push({ kind: 'OBLICZENIE', text: `Adres ${fmtAddr(k)} wykluczony z przypisania osobowego (0%): ${ex.reason} [${ex.rule}; dowód: ${ex.evidence}].` });
          if ((byKey.get(k) ?? []).length) conclusions.push({ kind: 'WNIOSEK', text: `Badana osoba wspomina adres ${ex.category === 'exchange' ? 'giełdy' : 'usługi'} ${fmtAddr(k).slice(0, 12)}… – możliwa interakcja z tą usługą (do weryfikacji, nie jest to portfel osoby).` });
          continue;
        }
        if (!(byKey.get(k) ?? []).length) {
          conclusions.push({ kind: 'WNIOSEK', text: `Adres wejściowy ${fmtAddr(k)}: nie znaleziono publicznych śladów Web2 łączących go z badaną osobą.` });
        } else {
          conclusions.push({ kind: 'OBLICZENIE', text: `Wskaźnik Pewności ${fmtAddr(k)} = ${sc.score}% (${sc.hits.filter((h) => h.kind !== 'factor').map((h) => h.rule).join(' + ')}).` });
        }
        const rep = chainReports.get(k);
        if (rep) {
          const m = rep.analysis.metrics;
          conclusions.push({
            kind: 'OBLICZENIE',
            text: `${fmtAddr(k).slice(0, 14)}…: ${m.txCount} transakcji (${m.firstSeen?.slice(0, 10) ?? '—'} – ${m.lastSeen?.slice(0, 10) ?? '—'}); wypływy: ${Object.entries(m.outflow).map(([a, v]) => `${v} ${a}`).join(', ') || '—'}; wskaźniki: ${rep.analysis.indicators.map((i) => i.id).join(', ') || 'brak'}.`,
          });
          if (sc.score >= 60 && (rep.analysis.cashOutLevel === 'wysoki' || rep.analysis.cashOutLevel === 'średni')) {
            conclusions.push({
              kind: 'WNIOSEK',
              text: `Adres ${fmtAddr(k).slice(0, 14)}… (pewność ${sc.score}%) wykazuje ${rep.analysis.cashOutLevel} poziom wskaźników wyjścia do fiat (${rep.analysis.indicators.filter((i) => i.severity !== 'info').map((i) => i.title.toLowerCase()).join('; ')}). Zalecana weryfikacja: zapytanie do dostawcy usług (VASP) o dane KYC i zestawienie z zeznaniem PIT-38.`,
            });
          }
        }
        if (sc.score >= 40 && sc.score < 60) conclusions.push({ kind: 'WNIOSEK', text: `Adres ${fmtAddr(k).slice(0, 14)}… ma średnią pewność (${sc.score}%) – wymaga potwierdzenia drugim, niezależnym śladem.` });
      }
      if (diff) {
        for (const sw of (diff as RunDiff).addressSwaps) conclusions.push({ kind: 'WNIOSEK', text: `Na profilu ${sw.url} podmieniono adres: ${sw.before.join(', ')} → ${sw.after.join(', ')}. Możliwa zmiana portfela – oba adresy należy uwzględnić w analizie.` });
      }
      const attributed = [...finalScores.values()].filter((x) => x.status === 'attributed' && x.score > 0);
      const sum = {
        sources: artifacts.length,
        profiles: artifacts.filter((a) => a.discovery !== 'search').length,
        addresses: allKeys.size,
        attributed: attributed.length,
        excluded: [...finalScores.values()].filter((x) => x.status === 'excluded').length,
        high: attributed.filter((x) => x.score >= 80).length,
        maxScore: Math.max(0, ...attributed.map((x) => x.score)),
        cashOutHigh: [...chainReports.values()].filter((r) => r.analysis.cashOutLevel === 'wysoki').length,
        otherAuthorAddresses: otherAuthors,
        rejectedCandidates: rejected.slice(0, 50),
        diffSummary: diff ? (diff as RunDiff).summary : null,
      };
      s.detail = `${conclusions.filter((c) => c.kind === 'FAKT').length} faktów, ${conclusions.filter((c) => c.kind === 'OBLICZENIE').length} obliczeń, ${conclusions.filter((c) => c.kind === 'WNIOSEK').length} wniosków`;
      return sum;
    });

    // 12. Opcjonalne streszczenie AI (nie wpływa na wynik)
    let aiSummary: string | null = null;
    const llm = getLlm();
    if (llm) {
      await step('ai', `Streszczenie AI (${llm.id}) – pomocnicze`, async (s) => {
        try {
          aiSummary = await llm.complete(
            'Jesteś asystentem analityka KAS. Streszczasz wyniki w 5-8 zdaniach po polsku, prostym językiem. Nie dodawaj faktów spoza danych. Zaznacz, że wnioski wymagają weryfikacji.',
            JSON.stringify(conclusions.slice(0, 60)),
          );
          versions.llm = llm.id;
        } catch (e) {
          s.status = 'warning';
          s.detail = (e as Error).message;
        }
      });
    }

    await q("UPDATE runs SET status='done', finished_at=now(), versions=$2, request_log=$3, summary=$4, conclusions=$5, diff=$6, ai_summary=$7 WHERE id=$1", [
      runId,
      JSON.stringify(versions),
      JSON.stringify(log),
      JSON.stringify(summary),
      JSON.stringify(conclusions),
      JSON.stringify(diff),
      aiSummary,
    ]);
    await q('UPDATE cases SET last_run_at=now() WHERE id=$1', [run.case_id]);
  } catch (e) {
    await q("UPDATE runs SET status='error', finished_at=now(), error=$2, versions=$3, request_log=$4 WHERE id=$1", [runId, (e as Error).stack ?? String(e), JSON.stringify(versions), JSON.stringify(log)]);
  }
}

export async function computeDiff(prevRunId: string, runId: string): Promise<RunDiff> {
  const load = async (id: string) => {
    const f = await q<{ chain: string; address: string; score: number; status: string; occurrences: { url: string }[] }>('SELECT chain, address, score, status, occurrences FROM findings WHERE run_id=$1', [id]);
    const a = await q<{ final_url: string }>('SELECT final_url FROM artifacts WHERE run_id=$1', [id]);
    return {
      findings: f.map((x) => ({ chain: x.chain, address: x.address, score: x.score, status: x.status, urls: [...new Set(x.occurrences.map((o) => o.url))] })),
      profiles: a.map((x) => x.final_url),
    };
  };
  return diffRuns(await load(prevRunId), await load(runId));
}

// ---- Kolejka zadań (w pamięci; do produkcji: kolejka trwała, np. BullMQ/pg-boss) ----
const jobQueue: string[] = [];
let busy = false;

export function enqueueRun(runId: string) {
  jobQueue.push(runId);
  void drain();
}

async function drain() {
  if (busy) return;
  busy = true;
  while (jobQueue.length) {
    const id = jobQueue.shift()!;
    await executeRun(id).catch(() => undefined);
  }
  busy = false;
}

export async function createRun(caseId: string, mode: Mode, trigger: 'manual' | 'schedule'): Promise<string> {
  const [{ seq }] = await q<{ seq: number }>('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM runs WHERE case_id=$1', [caseId]);
  const [r] = await q<{ id: string }>('INSERT INTO runs(case_id, seq, mode, trigger) VALUES ($1,$2,$3,$4) RETURNING id', [caseId, seq, mode, trigger]);
  enqueueRun(r.id);
  return r.id;
}

/** Harmonogram analiz cyklicznych – sprawdzany co 30 s. */
export function startScheduler() {
  setInterval(async () => {
    const due = await q<{ id: string; mode: Mode }>(
      `SELECT c.id, c.mode FROM cases c WHERE c.schedule_minutes IS NOT NULL AND c.schedule_minutes > 0
         AND (c.mode = 'demo' OR $1::boolean)
         AND (c.last_run_at IS NULL OR c.last_run_at + make_interval(mins => c.schedule_minutes) < now())
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.case_id=c.id AND r.status IN ('queued','running'))`,
      [config.liveEnabled],
    ).catch(() => []);
    for (const c of due) await createRun(c.id, c.mode, 'schedule');
  }, 30_000).unref();
}

// Przy restarcie oznaczamy przerwane przebiegi.
export async function recoverInterrupted() {
  await q("UPDATE runs SET status='error', error='Przerwane restartem serwera', finished_at=now() WHERE status IN ('queued','running')");
}
