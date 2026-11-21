// Generuje deterministyczne, poprawne kryptograficznie, ale SYNTETYCZNE adresy do scenariuszy testowych.
// Adres = skrót SHA-256 z jawnego ziarna (seed) – nikt nie posiada do nich kluczy prywatnych.
import { createHash } from 'node:crypto';
import { base58CheckEncode, segwitEncode, toEip55 } from '../src/core/addresses/codecs.js';

const h = (seed: string) => createHash('sha256').update('olcys-demo:' + seed).digest();

export const eth = (seed: string) => toEip55('0x' + h(seed).subarray(0, 20).toString('hex'));
export const btc = (seed: string) => segwitEncode('bc', 0, new Uint8Array(h(seed).subarray(0, 20)));
export const trx = (seed: string) => base58CheckEncode(new Uint8Array([0x41, ...h(seed).subarray(0, 20)]));

const seeds = {
  ETH_MAIN: eth('jan-main'),
  ETH_NEW: eth('jan-new'),
  ETH_GIVEAWAY: eth('jan-giveaway'),
  ETH_GAMEHUB_OTHER: eth('gamehub-other-person'),
  ETH_FORUM_OTHER1: eth('forum-other-1'),
  ETH_SYNTH_CONTRACT: eth('synthetic-contract'),
  ETH_P2P_ESCROW: eth('mock-p2p-escrow'),
  ETH_CARD_GATEWAY: eth('mock-card-gateway'),
  ETH_FRIEND: eth('friend-sender'),
  BTC_MAIN: btc('jan-btc'),
  BTC_OTHER: btc('forum-other-btc'),
  TRX_MAIN: trx('jan-tron'),
};
if (process.argv[1]?.includes('gen-demo-addresses')) console.log(JSON.stringify(seeds, null, 2));
