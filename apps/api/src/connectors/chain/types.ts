// Wspólny model danych blockchain – każdy dostawca (Blockscout, mempool.space, fixtures…)
// normalizuje swoje odpowiedzi do tych typów. Dodanie nowej sieci = nowy ChainProvider.
import type { Chain } from '../../core/addresses/extract.js';

export interface NormalizedTx {
  hash: string;
  time: string; // ISO 8601
  direction: 'in' | 'out' | 'self';
  counterparty: string | null;
  asset: string; // ETH, BTC, USDT, USDC…
  amount: number;
  kind: 'native' | 'token' | 'contract_call';
  method?: string;
}

export interface ProviderTag {
  name: string;
  category?: string;
  source: string;
}

export interface AddressInfo {
  chain: Chain;
  address: string;
  /** true = konto z kodem (bytecode != 0x) – smart kontrakt. null = nie sprawdzono. */
  isContract: boolean | null;
  bytecodeEvidence?: string;
  tags: ProviderTag[];
  txCount?: number;
}

export interface RequestLogEntry {
  url: string;
  status: number | string;
  at: string;
  ms: number;
}

export interface ChainProvider {
  id: string;
  description: string;
  supports(chain: Chain): boolean;
  getInfo(chain: Chain, address: string, log: RequestLogEntry[]): Promise<AddressInfo>;
  getTransactions(chain: Chain, address: string, log: RequestLogEntry[]): Promise<NormalizedTx[]>;
}
