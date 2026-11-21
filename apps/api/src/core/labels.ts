// Lokalny rejestr etykiet adresów (giełdy, kontrakty, miksery, zbiórki, bramki fiat).
// Darmowe API eksploratorów zwykle nie udostępniają etykiet, więc utrzymujemy własną bazę
// z publicznych źródeł, rozszerzalną przez dodanie pliku JSON w data/labels/.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Chain } from './addresses/extract.js';
import { normalizeAddress } from './addresses/extract.js';
import type { ExclusionCategory } from './scoring.js';

export interface AddressLabel {
  chain: Chain;
  address: string;
  name: string;
  category: ExclusionCategory;
  source: string;
  synthetic?: boolean;
}

export const CATEGORY_LABELS: Record<ExclusionCategory, string> = {
  exchange: 'Giełda scentralizowana (CEX)',
  custodial: 'Portfel powierniczy',
  contract: 'Smart kontrakt',
  mixer: 'Mikser / usługa anonimizująca',
  charity: 'Zbiórka charytatywna',
  institution: 'Adres instytucjonalny',
  token: 'Kontrakt tokena',
  defi: 'Protokół DeFi / DEX',
  p2p: 'Usługa P2P / escrow',
  offramp: 'Bramka krypto-fiat / karta krypto',
  bridge: 'Most międzyłańcuchowy',
};

export class LabelRegistry {
  private map = new Map<string, AddressLabel>();
  readonly files: string[] = [];

  constructor(dir: string) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const items = JSON.parse(readFileSync(join(dir, f), 'utf8')) as AddressLabel[];
      for (const l of items) this.map.set(`${l.chain}:${normalizeAddress(l.chain, l.address)}`, l);
      this.files.push(f);
    }
  }

  get(chain: Chain, address: string): AddressLabel | null {
    return this.map.get(`${chain}:${normalizeAddress(chain, address)}`) ?? null;
  }

  get size() {
    return this.map.size;
  }
}
