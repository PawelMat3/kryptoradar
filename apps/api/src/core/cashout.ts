// Analiza aktywności on-chain i wskaźniki wyjścia do walut tradycyjnych (Fiat Cash-Out).
// Wszystkie wskaźniki są regułami – każdy wskazuje konkretne transakcje jako dowód.
import type { Chain } from './addresses/extract.js';
import type { NormalizedTx } from '../connectors/chain/types.js';
import { CATEGORY_LABELS, type AddressLabel } from './labels.js';

export const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'EURC', 'PYUSD', 'BUSD', 'FDUSD']);

/** Progi "znacznej wartości" – założenia konfiguracyjne, opisane w raporcie. */
export const LARGE_THRESHOLDS: Record<string, number> = { ETH: 5, BTC: 0.25, USDT: 5000, USDC: 5000, DAI: 5000, TRX: 50000, LTC: 50 };

export interface Indicator {
  id: string;
  severity: 'high' | 'medium' | 'info';
  title: string;
  explanation: string;
  txs: string[];
}

export interface FlowRow extends NormalizedTx {
  counterpartyLabel: string | null;
  counterpartyCategory: string | null;
}

export interface ChainAnalysis {
  metrics: {
    txCount: number;
    firstSeen: string | null;
    lastSeen: string | null;
    inflow: Record<string, number>;
    outflow: Record<string, number>;
    uniqueCounterparties: number;
    stablecoinVolume: number;
    byCategory: Record<string, { txs: number; label: string }>;
  };
  indicators: Indicator[];
  flows: FlowRow[];
  cashOutLevel: 'brak' | 'niski' | 'średni' | 'wysoki';
}

type LabelLookup = (chain: Chain, address: string) => AddressLabel | null;

const add = (m: Record<string, number>, k: string, v: number) => (m[k] = Math.round(((m[k] ?? 0) + v) * 1e8) / 1e8);
const fmt = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 6 });

export function analyzeActivity(chain: Chain, txs: NormalizedTx[], lookup: LabelLookup): ChainAnalysis {
  const flows: FlowRow[] = [...txs]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((t) => {
      const l = t.counterparty ? lookup(chain, t.counterparty) : null;
      return { ...t, counterpartyLabel: l?.name ?? null, counterpartyCategory: l?.category ?? null };
    });

  const inflow: Record<string, number> = {};
  const outflow: Record<string, number> = {};
  const byCategory: Record<string, { txs: number; label: string }> = {};
  const cps = new Set<string>();
  let stable = 0;
  for (const f of flows) {
    if (f.direction === 'in') add(inflow, f.asset, f.amount);
    if (f.direction === 'out') add(outflow, f.asset, f.amount);
    if (f.counterparty) cps.add(f.counterparty.toLowerCase());
    if (STABLECOINS.has(f.asset)) stable += f.amount;
    if (f.counterpartyCategory) {
      const c = (byCategory[f.counterpartyCategory] ??= { txs: 0, label: CATEGORY_LABELS[f.counterpartyCategory as keyof typeof CATEGORY_LABELS] ?? f.counterpartyCategory });
      c.txs++;
    }
  }

  const ind: Indicator[] = [];
  const of = (pred: (f: FlowRow) => boolean) => flows.filter(pred);

  const cexOut = of((f) => f.direction === 'out' && (f.counterpartyCategory === 'exchange' || f.counterpartyCategory === 'custodial'));
  if (cexOut.length)
    ind.push({
      id: 'CEX_DEPOSIT',
      severity: 'high',
      title: 'Wpłaty na giełdę scentralizowaną',
      explanation: `${cexOut.length} transakcji wychodzących do adresów giełd (${[...new Set(cexOut.map((f) => f.counterpartyLabel))].join(', ')}): ${cexOut.map((f) => `${fmt(f.amount)} ${f.asset}`).join(', ')}. Giełda umożliwia wymianę na PLN/EUR/USD – możliwy punkt wyjścia do fiat.`,
      txs: cexOut.map((f) => f.hash),
    });

  const offramp = of((f) => f.direction === 'out' && f.counterpartyCategory === 'offramp');
  if (offramp.length)
    ind.push({
      id: 'OFFRAMP_GATEWAY',
      severity: 'high',
      title: 'Bramka krypto-fiat / karta krypto',
      explanation: `${offramp.length} transakcji do bramek płatniczych lub dostawców kart krypto (${[...new Set(offramp.map((f) => f.counterpartyLabel))].join(', ')}).`,
      txs: offramp.map((f) => f.hash),
    });

  const p2p = of((f) => f.counterpartyCategory === 'p2p');
  if (p2p.length)
    ind.push({
      id: 'P2P_SERVICE',
      severity: 'medium',
      title: 'Interakcje z usługą P2P / escrow',
      explanation: `${p2p.length} transakcji z usługami P2P (${[...new Set(p2p.map((f) => f.counterpartyLabel))].join(', ')}) – typowy kanał sprzedaży kryptowalut za gotówkę lub przelew.`,
      txs: p2p.map((f) => f.hash),
    });

  // Wymiana na stablecoiny: wyjście do DEX, a w ciągu 24h wpływ stablecoina.
  const swaps: string[] = [];
  for (const f of flows.filter((x) => x.direction === 'out' && x.counterpartyCategory === 'defi')) {
    const t0 = Date.parse(f.time);
    const back = flows.find((g) => g.direction === 'in' && STABLECOINS.has(g.asset) && Math.abs(Date.parse(g.time) - t0) <= 86_400_000);
    if (back) swaps.push(f.hash, back.hash);
  }
  const bigStableIn = of((f) => f.direction === 'in' && STABLECOINS.has(f.asset) && f.amount >= (LARGE_THRESHOLDS[f.asset] ?? Infinity));
  if (swaps.length || bigStableIn.length)
    ind.push({
      id: 'STABLECOIN_SWAP',
      severity: 'medium',
      title: 'Wymiana na stablecoiny',
      explanation: `${swaps.length ? 'Wymiana przez protokół DEX zakończona wpływem stablecoina w ciągu 24 h. ' : ''}${bigStableIn.length ? `Znaczne wpływy stablecoinów (≥ progu): ${bigStableIn.map((f) => `${fmt(f.amount)} ${f.asset}`).join(', ')}.` : ''} Stablecoiny są częstym etapem przed wymianą na fiat.`,
      txs: [...new Set([...swaps, ...bigStableIn.map((f) => f.hash)])],
    });

  const mixer = of((f) => f.counterpartyCategory === 'mixer');
  if (mixer.length)
    ind.push({
      id: 'MIXER',
      severity: 'high',
      title: 'Interakcje z mikserem',
      explanation: `${mixer.length} transakcji z usługą anonimizującą (${[...new Set(mixer.map((f) => f.counterpartyLabel))].join(', ')}). Utrudnia śledzenie przepływu środków.`,
      txs: mixer.map((f) => f.hash),
    });

  const cexIn = of((f) => f.direction === 'in' && f.counterpartyCategory === 'exchange');
  if (cexIn.length)
    ind.push({
      id: 'CEX_WITHDRAWAL',
      severity: 'info',
      title: 'Wypłaty z giełdy (zakup kryptowalut)',
      explanation: `${cexIn.length} wpływów z adresów giełd – prawdopodobny zakup kryptowalut za fiat (on-ramp), istotny dla ustalenia kosztu nabycia.`,
      txs: cexIn.map((f) => f.hash),
    });

  const large = Object.entries(outflow).filter(([a, v]) => v >= (LARGE_THRESHOLDS[a] ?? Infinity));
  if (large.length)
    ind.push({
      id: 'HIGH_VOLUME',
      severity: 'info',
      title: 'Znaczny wolumen wypływów',
      explanation: `Łączne wypływy przekraczają progi: ${large.map(([a, v]) => `${fmt(v)} ${a} (próg ${fmt(LARGE_THRESHOLDS[a])})`).join(', ')}.`,
      txs: [],
    });

  const highs = ind.filter((i) => i.severity === 'high').length;
  const meds = ind.filter((i) => i.severity === 'medium').length;
  const cashOutLevel = highs >= 2 || (highs && meds) ? 'wysoki' : highs || meds >= 2 ? 'średni' : meds ? 'niski' : 'brak';

  return {
    metrics: {
      txCount: flows.length,
      firstSeen: flows[0]?.time ?? null,
      lastSeen: flows.at(-1)?.time ?? null,
      inflow,
      outflow,
      uniqueCounterparties: cps.size,
      stablecoinVolume: Math.round(stable * 100) / 100,
      byCategory,
    },
    indicators: ind,
    flows,
    cashOutLevel,
  };
}
