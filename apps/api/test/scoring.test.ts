import { describe, expect, it } from 'vitest';
import { scoreAddress, scoreOccurrence, tierOf, type Occurrence } from '../src/core/scoring.js';
import { assessIdentity, nameConflicts } from '../src/core/identity.js';
import { analyzeActivity } from '../src/core/cashout.js';
import { diffRuns } from '../src/core/diff.js';

const occ = (over: Partial<Occurrence> = {}): Occurrence => ({
  artifactId: 'a1',
  sourceId: 'devhub',
  sourceName: 'DevHub',
  url: 'http://devhub.test/x',
  category: 'OWN_PROFILE',
  context: 'neutralny tekst',
  quoted: false,
  author: null,
  identity: { factor: 1, hits: [] },
  retrievedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const scored = (o: Occurrence) => ({ ...o, occ: scoreOccurrence(o) });

describe('Wskaźnik Pewności – progi z załącznika', () => {
  it('własny profil → 80–100%', () => {
    const s = scoreAddress({ occurrences: [scored(occ())], exclusion: null, onChainLinks: [] });
    expect(s.score).toBeGreaterThanOrEqual(80);
    expect(s.tier).toBe('BARDZO_WYSOKIE');
  });
  it('ogłoszenie P2P → 60–79%', () => {
    const s = scoreAddress({ occurrences: [scored(occ({ category: 'P2P_LISTING' }))], exclusion: null, onChainLinks: [] });
    expect(s.score).toBeGreaterThanOrEqual(60);
    expect(s.score).toBeLessThan(80);
  });
  it('forum → 40–59%', () => {
    const s = scoreAddress({ occurrences: [scored(occ({ category: 'FORUM_POST' }))], exclusion: null, onChainLinks: [] });
    expect(s.tier).toBe('SREDNIE');
  });
  it('giveaway → 10–39%', () => {
    const s = scoreAddress({ occurrences: [scored(occ({ category: 'MASS_COMMENT' }))], exclusion: null, onChainLinks: [] });
    expect(s.tier).toBe('NISKIE');
  });
  it('giełda → 0% i status wykluczony, mimo publikacji na własnym profilu', () => {
    const s = scoreAddress({
      occurrences: [scored(occ())],
      exclusion: { rule: 'EXCL_LABEL_EXCHANGE', reason: 'Binance', category: 'exchange', evidence: 'rejestr' },
      onChainLinks: [],
    });
    expect(s.score).toBe(0);
    expect(s.status).toBe('excluded');
    expect(tierOf(0, true)).toBe('WYKLUCZONE');
  });
});

describe('synergia i kontekst', () => {
  it('+15 za dwa niezależne źródła, ale nie za dwa wystąpienia w tym samym serwisie', () => {
    const two = scoreAddress({ occurrences: [scored(occ({ category: 'P2P_LISTING', sourceId: 'p2p' })), scored(occ({ category: 'FORUM_POST', sourceId: 'forum' }))], exclusion: null, onChainLinks: [] });
    const same = scoreAddress({ occurrences: [scored(occ({ category: 'P2P_LISTING', sourceId: 'p2p' })), scored(occ({ category: 'P2P_LISTING', sourceId: 'p2p', artifactId: 'a2' }))], exclusion: null, onChainLinks: [] });
    expect(two.score).toBe(same.score + 15);
    expect(two.hits.some((h) => h.rule === 'SYNERGY')).toBe(true);
    expect(same.hits.some((h) => h.rule === 'SYNERGY')).toBe(false);
  });
  it('wynik nie przekracza 100%', () => {
    const s = scoreAddress({ occurrences: [scored(occ({ context: 'mój portfel' })), scored(occ({ sourceId: 'site', category: 'PERSONAL_SITE' }))], exclusion: null, onChainLinks: [] });
    expect(s.score).toBe(100);
  });
  it('kontekst cudzego adresu („wysyłam na binance”) obniża wynik', () => {
    const neutral = scoreOccurrence(occ({ category: 'FORUM_POST' })).score;
    const third = scoreOccurrence(occ({ category: 'FORUM_POST', context: 'wysyłam na binance ten adres' })).score;
    expect(third).toBeLessThan(neutral);
  });
  it('cytat obniża wynik o 20 pkt', () => {
    expect(scoreOccurrence(occ({ quoted: true })).score).toBe(scoreOccurrence(occ()).score - 20);
  });
  it('źródła o niskiej pewności tożsamości nie dają synergii', () => {
    const s = scoreAddress({
      occurrences: [scored(occ({ sourceId: 'a', identity: { factor: 0.3, hits: [] } })), scored(occ({ sourceId: 'b', identity: { factor: 0.3, hits: [] } }))],
      exclusion: null,
      onChainLinks: [],
    });
    expect(s.hits.some((h) => h.rule === 'SYNERGY')).toBe(false);
  });
});

describe('tożsamość profilu', () => {
  it('profil wskazany przez analityka → 1.0', () => {
    expect(assessIdentity({ discovery: 'analyst', linkedFrom: [], linksToSubject: [], tokenMatches: [], nickPopularity: null, username: null, conflictingName: null }).factor).toBe(1);
  });
  it('sam nick (Maigret) z konfliktem nazwiska → niska pewność', () => {
    const f = assessIdentity({ discovery: 'maigret', linkedFrom: [], linksToSubject: [], tokenMatches: [], nickPopularity: 0.2, username: 'kryptokowal77', conflictingName: 'Piotr Inny' }).factor;
    expect(f).toBeLessThan(0.3);
  });
  it('nick + link z profilu osoby → wysoka pewność', () => {
    const f = assessIdentity({ discovery: 'maigret', linkedFrom: [{ url: 'x', factor: 0.9 }], linksToSubject: [], tokenMatches: [], nickPopularity: 0.2, username: 'kryptokowal77', conflictingName: null }).factor;
    expect(f).toBeGreaterThanOrEqual(0.85);
  });
  it('pospolity nick obniża pewność', () => {
    const base = { discovery: 'maigret' as const, linkedFrom: [], linksToSubject: [], tokenMatches: [], username: 'kowal', conflictingName: null };
    expect(assessIdentity({ ...base, nickPopularity: 0.8 }).factor).toBeLessThan(assessIdentity({ ...base, nickPopularity: 0.1 }).factor);
  });
  it('nameConflicts porównuje człony nazwiska bez polskich znaków', () => {
    expect(nameConflicts('Jan Testowy', 'Jan TESTOWY')).toBe(false);
    expect(nameConflicts('Jan Testowy', 'Piotr Inny')).toBe(true);
    expect(nameConflicts('Łukasz Żółć', 'Lukasz Zolc')).toBe(false);
  });
});

describe('wskaźniki cash-out', () => {
  const lookup = (_c: string, a: string) =>
    ({
      '0xcex': { chain: 'ETH', address: '0xcex', name: 'Binance 14', category: 'exchange', source: 't' },
      '0xdex': { chain: 'ETH', address: '0xdex', name: 'Uniswap', category: 'defi', source: 't' },
      '0xmix': { chain: 'ETH', address: '0xmix', name: 'Tornado', category: 'mixer', source: 't' },
    })[a.toLowerCase()] as never;
  it('wykrywa wpłatę na giełdę, wymianę na stablecoin i mikser', () => {
    const a = analyzeActivity(
      'ETH',
      [
        { hash: 't1', time: '2025-01-01T10:00:00Z', direction: 'out', counterparty: '0xdex', asset: 'ETH', amount: 1, kind: 'contract_call' },
        { hash: 't2', time: '2025-01-01T10:00:30Z', direction: 'in', counterparty: '0xdex', asset: 'USDT', amount: 3000, kind: 'token' },
        { hash: 't3', time: '2025-01-05T10:00:00Z', direction: 'out', counterparty: '0xcex', asset: 'USDT', amount: 3000, kind: 'token' },
        { hash: 't4', time: '2025-01-06T10:00:00Z', direction: 'out', counterparty: '0xmix', asset: 'ETH', amount: 0.1, kind: 'native' },
      ],
      lookup,
    );
    const ids = a.indicators.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['CEX_DEPOSIT', 'STABLECOIN_SWAP', 'MIXER']));
    expect(a.cashOutLevel).toBe('wysoki');
    expect(a.indicators.find((i) => i.id === 'CEX_DEPOSIT')!.txs).toEqual(['t3']);
  });
});

describe('porównanie przebiegów', () => {
  it('wykrywa podmianę adresu na tym samym profilu', () => {
    const d = diffRuns(
      { findings: [{ chain: 'ETH', address: '0xA', score: 90, status: 'attributed', urls: ['http://devhub.test/u'] }], profiles: ['http://devhub.test/u'] },
      { findings: [{ chain: 'ETH', address: '0xB', score: 90, status: 'attributed', urls: ['http://devhub.test/u'] }], profiles: ['http://devhub.test/u'] },
    );
    expect(d.addressSwaps).toEqual([{ url: 'http://devhub.test/u', before: ['0xA'], after: ['0xB'] }]);
    expect(d.newAddresses).toHaveLength(1);
    expect(d.removedAddresses).toHaveLength(1);
  });
});
