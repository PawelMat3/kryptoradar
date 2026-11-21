// Dostawcy danych blockchain. Wszystkie są oprogramowaniem open source możliwym do
// samodzielnego hostowania (Blockscout, mempool.space) – zgodnie z docelowym wdrożeniem
// w środowisku KAS bez zależności od publicznej chmury (adres bazowy konfigurowalny).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, type Mode } from '../../config.js';
import type { Chain } from '../../core/addresses/extract.js';
import { safeJson, safeFetch } from '../http.js';
import type { AddressInfo, ChainProvider, NormalizedTx, RequestLogEntry } from './types.js';

const env = (k: string, d: string) => process.env[k]?.trim() || d;

// ---------- Fixtures (tryb demo: zapisane, syntetyczne historie transakcji) ----------
interface FixtureEntry {
  info: Omit<AddressInfo, 'chain' | 'address'>;
  txs: NormalizedTx[];
}

export class FixtureProvider implements ChainProvider {
  id = 'fixtures';
  description = 'Syntetyczne historie transakcji (data/fixtures/chain.json) – tryb demo, bez ruchu sieciowego';
  private data: Record<string, FixtureEntry> = {};
  constructor() {
    const f = join(config.dataDir, 'fixtures', 'chain.json');
    if (existsSync(f)) {
      const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, FixtureEntry>;
      for (const [k, v] of Object.entries(raw)) this.data[k.toLowerCase()] = v;
    }
  }
  has(chain: Chain, address: string) {
    return `${chain}:${address}`.toLowerCase() in this.data;
  }
  supports() {
    return true;
  }
  async getInfo(chain: Chain, address: string, log: RequestLogEntry[]): Promise<AddressInfo> {
    log.push({ url: `fixture://${chain}/${address}`, status: this.has(chain, address) ? 200 : 404, at: new Date().toISOString(), ms: 0 });
    const e = this.data[`${chain}:${address}`.toLowerCase()];
    // Brak wpisu w fixtures = adres niesprawdzony (null), a nie "na pewno nie kontrakt".
    return { chain, address, isContract: e?.info.isContract ?? null, bytecodeEvidence: e?.info.bytecodeEvidence, tags: e?.info.tags ?? [], txCount: e?.txs.length ?? 0 };
  }
  async getTransactions(chain: Chain, address: string): Promise<NormalizedTx[]> {
    return this.data[`${chain}:${address}`.toLowerCase()]?.txs ?? [];
  }
}

// ---------- Blockscout (Ethereum i inne sieci EVM) ----------
type BsAddr = { hash?: string } | null;
const lc = (a?: string | null) => (a ?? '').toLowerCase();

export class BlockscoutProvider implements ChainProvider {
  id = 'blockscout';
  description = 'Blockscout API v2 (open source, możliwy self-hosting)';
  base = env('BLOCKSCOUT_URL', 'https://eth.blockscout.com');
  supports(chain: Chain) {
    return chain === 'ETH';
  }
  async getInfo(chain: Chain, address: string, log: RequestLogEntry[]): Promise<AddressInfo> {
    const j = await safeJson<{
      is_contract?: boolean;
      name?: string | null;
      public_tags?: { display_name: string; label?: string }[];
      metadata?: { tags?: { name: string; tagType?: string }[] } | null;
    }>(`${this.base}/api/v2/addresses/${address}`, log);
    // Weryfikacja bytecode wprost przez eth_getCode (KROK 3.2 załącznika).
    let code = '';
    try {
      const r = await safeFetch(`${this.base}/api/eth-rpc`, log, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
      });
      code = (JSON.parse(r.body) as { result?: string }).result ?? '';
    } catch {
      code = '';
    }
    const tags = [
      ...(j.name ? [{ name: j.name, source: 'blockscout:name' }] : []),
      ...(j.public_tags ?? []).map((t) => ({ name: t.display_name, category: t.label, source: 'blockscout:public_tag' })),
      ...(j.metadata?.tags ?? []).map((t) => ({ name: t.name, category: t.tagType, source: 'blockscout:metadata' })),
    ];
    const isContract = code ? code !== '0x' : (j.is_contract ?? null);
    return { chain, address, isContract, bytecodeEvidence: code ? `eth_getCode → ${code.slice(0, 18)}${code.length > 18 ? '…' : ''} (${Math.max(0, (code.length - 2) / 2)} B)` : undefined, tags };
  }
  async getTransactions(_chain: Chain, address: string, log: RequestLogEntry[]): Promise<NormalizedTx[]> {
    const me = lc(address);
    const out: NormalizedTx[] = [];
    const txs = await safeJson<{ items: { hash: string; timestamp: string; from: BsAddr; to: BsAddr; value: string; method?: string | null }[] }>(
      `${this.base}/api/v2/addresses/${address}/transactions`,
      log,
    );
    for (const t of txs.items ?? []) {
      const from = lc(t.from?.hash);
      const to = lc(t.to?.hash);
      const value = Number(BigInt(t.value || '0')) / 1e18;
      const direction = from === me && to === me ? 'self' : from === me ? 'out' : 'in';
      out.push({
        hash: t.hash,
        time: t.timestamp,
        direction,
        counterparty: direction === 'out' ? to || null : from || null,
        asset: 'ETH',
        amount: value,
        kind: value > 0 ? 'native' : 'contract_call',
        method: t.method ?? undefined,
      });
    }
    try {
      const tt = await safeJson<{
        items: { transaction_hash?: string; tx_hash?: string; timestamp: string; from: BsAddr; to: BsAddr; total?: { value?: string; decimals?: string }; token?: { symbol?: string } }[];
      }>(`${this.base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`, log);
      for (const t of tt.items ?? []) {
        const from = lc(t.from?.hash);
        const dec = Number(t.total?.decimals ?? '18');
        out.push({
          hash: t.transaction_hash ?? t.tx_hash ?? '',
          time: t.timestamp,
          direction: from === me ? 'out' : 'in',
          counterparty: from === me ? lc(t.to?.hash) : from,
          asset: t.token?.symbol ?? 'ERC20',
          amount: Number(t.total?.value ?? '0') / 10 ** dec,
          kind: 'token',
        });
      }
    } catch {
      /* transfery tokenów opcjonalne */
    }
    return out;
  }
}

// ---------- mempool.space (Bitcoin) ----------
interface MsTx {
  txid: string;
  status: { block_time?: number };
  vin: { prevout?: { scriptpubkey_address?: string; value: number } }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}

export class MempoolProvider implements ChainProvider {
  id = 'mempool';
  description = 'mempool.space API (open source, możliwy self-hosting)';
  base = env('MEMPOOL_URL', 'https://mempool.space');
  supports(chain: Chain) {
    return chain === 'BTC';
  }
  async getInfo(chain: Chain, address: string, log: RequestLogEntry[]): Promise<AddressInfo> {
    const j = await safeJson<{ chain_stats: { tx_count: number } }>(`${this.base}/api/address/${address}`, log);
    return { chain, address, isContract: null, tags: [], txCount: j.chain_stats.tx_count };
  }
  async getTransactions(_chain: Chain, address: string, log: RequestLogEntry[]): Promise<NormalizedTx[]> {
    const txs = await safeJson<MsTx[]>(`${this.base}/api/address/${address}/txs`, log);
    return txs.map((t) => {
      const sent = t.vin.filter((v) => v.prevout?.scriptpubkey_address === address).reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
      const recv = t.vout.filter((v) => v.scriptpubkey_address === address).reduce((s, v) => s + v.value, 0);
      const net = recv - sent;
      const out = net < 0;
      const cp = out
        ? [...t.vout].filter((v) => v.scriptpubkey_address && v.scriptpubkey_address !== address).sort((a, b) => b.value - a.value)[0]?.scriptpubkey_address
        : t.vin.find((v) => v.prevout?.scriptpubkey_address && v.prevout.scriptpubkey_address !== address)?.prevout?.scriptpubkey_address;
      return {
        hash: t.txid,
        time: t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : new Date().toISOString(),
        direction: out ? 'out' : 'in',
        counterparty: cp ?? null,
        asset: 'BTC',
        amount: Math.abs(net) / 1e8,
        kind: 'native',
      } satisfies NormalizedTx;
    });
  }
}

export const fixtures = new FixtureProvider();
const live: ChainProvider[] = [new BlockscoutProvider(), new MempoolProvider()];

export function providerFor(chain: Chain, address: string, mode: Mode): ChainProvider | null {
  if (mode === 'demo' || fixtures.has(chain, address)) return fixtures;
  return live.find((p) => p.supports(chain)) ?? null;
}

export function providerCatalog() {
  return [fixtures, ...live].map((p) => ({ id: p.id, description: p.description, chains: (['BTC', 'ETH', 'TRX', 'LTC'] as Chain[]).filter((c) => p.supports(c)) }));
}
