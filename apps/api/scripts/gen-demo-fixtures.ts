// Generuje data/fixtures/chain.json – syntetyczne historie transakcji dla scenariusza demo.
// Uruchomienie: npx tsx scripts/gen-demo-fixtures.ts
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eth, btc, trx } from './gen-demo-addresses.js';

const tx = (seed: string, prefix = '0x') => prefix + createHash('sha256').update('olcys-tx:' + seed).digest('hex');
const btcTx = (seed: string) => tx(seed, '');

const BINANCE14 = '0x28C6c06298d514Db089934071355E5743bf21d60';
const KRAKEN = '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2';
const UNI_V2 = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const TORNADO01 = '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc';
const BINANCE_BTC = '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo';

const A = {
  MAIN: eth('jan-main'),
  NEW: eth('jan-new'),
  GIVEAWAY: eth('jan-giveaway'),
  OTHER: eth('gamehub-other-person'),
  FORUM_OTHER: eth('forum-other-1'),
  CONTRACT: eth('synthetic-contract'),
  ESCROW: eth('mock-p2p-escrow'),
  CARD: eth('mock-card-gateway'),
  FRIEND: eth('friend-sender'),
  BTC: btc('jan-btc'),
  TRX: trx('jan-tron'),
};

const eoa = { isContract: false, bytecodeEvidence: 'eth_getCode → 0x (0 B) [fixture]', tags: [] };

const data: Record<string, unknown> = {
  [`ETH:${A.MAIN}`]: {
    info: eoa,
    txs: [
      { hash: tx('m1'), time: '2025-01-10T09:12:00Z', direction: 'in', counterparty: KRAKEN, asset: 'ETH', amount: 2.4, kind: 'native' },
      { hash: tx('m2'), time: '2025-01-22T18:40:00Z', direction: 'in', counterparty: A.FRIEND, asset: 'ETH', amount: 1.1, kind: 'native' },
      { hash: tx('m3'), time: '2025-02-03T11:05:00Z', direction: 'out', counterparty: UNI_V2, asset: 'ETH', amount: 1.5, kind: 'contract_call', method: 'swapExactETHForTokens' },
      { hash: tx('m4'), time: '2025-02-03T11:05:12Z', direction: 'in', counterparty: UNI_V2, asset: 'USDT', amount: 4820.55, kind: 'token' },
      { hash: tx('m5'), time: '2025-02-11T08:30:00Z', direction: 'out', counterparty: BINANCE14, asset: 'USDT', amount: 4800, kind: 'token' },
      { hash: tx('m6'), time: '2025-03-15T20:15:00Z', direction: 'out', counterparty: A.ESCROW, asset: 'ETH', amount: 0.8, kind: 'native' },
      { hash: tx('m7'), time: '2025-04-01T12:00:00Z', direction: 'in', counterparty: A.FRIEND, asset: 'USDC', amount: 750, kind: 'token' },
      { hash: tx('m8'), time: '2025-04-02T15:45:00Z', direction: 'out', counterparty: A.CARD, asset: 'USDC', amount: 700, kind: 'token' },
      { hash: tx('m9'), time: '2025-06-20T10:00:00Z', direction: 'out', counterparty: A.NEW, asset: 'ETH', amount: 0.9, kind: 'native' },
    ],
  },
  [`ETH:${A.NEW}`]: {
    info: eoa,
    txs: [
      { hash: tx('m9'), time: '2025-06-20T10:00:00Z', direction: 'in', counterparty: A.MAIN, asset: 'ETH', amount: 0.9, kind: 'native' },
      { hash: tx('n2'), time: '2025-07-04T21:30:00Z', direction: 'out', counterparty: TORNADO01, asset: 'ETH', amount: 0.1, kind: 'contract_call', method: 'deposit' },
      { hash: tx('n3'), time: '2025-07-10T09:00:00Z', direction: 'out', counterparty: BINANCE14, asset: 'ETH', amount: 0.7, kind: 'native' },
    ],
  },
  [`ETH:${A.GIVEAWAY}`]: {
    info: eoa,
    txs: [{ hash: tx('g1'), time: '2025-05-05T10:00:00Z', direction: 'in', counterparty: A.FRIEND, asset: 'ETH', amount: 0.01, kind: 'native' }],
  },
  [`ETH:${A.OTHER}`]: {
    info: eoa,
    txs: [{ hash: tx('o1'), time: '2024-11-11T11:11:00Z', direction: 'in', counterparty: A.FRIEND, asset: 'ETH', amount: 0.3, kind: 'native' }],
  },
  [`ETH:${A.CONTRACT}`]: {
    info: { isContract: true, bytecodeEvidence: 'eth_getCode → 0x6080604052348015… (2 417 B) [fixture]', tags: [] },
    txs: [],
  },
  [`BTC:${A.BTC}`]: {
    info: { isContract: null, tags: [] },
    txs: [
      { hash: btcTx('b1'), time: '2025-01-28T07:00:00Z', direction: 'in', counterparty: btc('p2p-buyer-1'), asset: 'BTC', amount: 0.042, kind: 'native' },
      { hash: btcTx('b2'), time: '2025-02-14T16:20:00Z', direction: 'in', counterparty: btc('p2p-buyer-2'), asset: 'BTC', amount: 0.065, kind: 'native' },
      { hash: btcTx('b3'), time: '2025-03-02T13:10:00Z', direction: 'out', counterparty: BINANCE_BTC, asset: 'BTC', amount: 0.1, kind: 'native' },
    ],
  },
};

const out = join(import.meta.dirname, '..', 'data', 'fixtures');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'chain.json'), JSON.stringify(data, null, 2) + '\n');
console.log('Zapisano', Object.keys(data).length, 'adresów; TRX bez dostawcy:', A.TRX);
