// Wykrywanie i ekstrakcja adresów kryptowalutowych z dowolnego tekstu.
// Etap 1: kandydaci z wyrażeń regularnych. Etap 2: walidacja sumy kontrolnej (codecs.ts).
// Każdy wynik niesie pozycję i kontekst, żeby analityk widział, skąd adres pochodzi.
import { base58CheckDecode, eip55Status, segwitDecode, toEip55 } from './codecs.js';

export type Chain = 'BTC' | 'ETH' | 'TRX' | 'LTC';

export interface ExtractedAddress {
  chain: Chain;
  /** Postać kanoniczna (ETH: EIP-55, bech32: małe litery). */
  address: string;
  /** Dokładnie tak, jak wystąpił w tekście. */
  raw: string;
  format: string;
  index: number;
  context: string;
  /** Zdanie zawierające adres – na nim działają reguły kontekstu (bez "przeciekania" z sąsiednich zdań). */
  sentence: string;
  /** Informacja o walidacji, pokazywana w raporcie jako fakt techniczny. */
  validation: string;
  /** Adres EVM może dotyczyć wielu sieci (Ethereum, BSC, Polygon…). */
  evmCompatible?: boolean;
}

export interface RejectedCandidate {
  raw: string;
  reason: string;
  index: number;
}

const CONTEXT_CHARS = 140;

function contextOf(text: string, index: number, len: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const end = Math.min(text.length, index + len + CONTEXT_CHARS);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

/** Zdanie wokół adresu: granice to . ! ? lub nowa linia (kropka w środku słowa, np. "p2p.test", nie kończy zdania). */
function sentenceOf(text: string, index: number, len: number): string {
  const isEnd = (i: number) => /[!?\n]/.test(text[i]) || (text[i] === '.' && (i + 1 >= text.length || /\s/.test(text[i + 1])));
  let s = index;
  while (s > 0 && index - s < 240 && !isEnd(s - 1)) s--;
  let e = index + len;
  while (e < text.length && e - index < 240 && !isEnd(e)) e++;
  return text.slice(s, e).replace(/\s+/g, ' ').trim();
}

const ETH_RE = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/g;
const B58_RE = /(?<![0-9A-Za-z])[13LMT][1-9A-HJ-NP-Za-km-z]{25,34}(?![0-9A-Za-z])/g;
const BECH32_RE = /(?<![0-9A-Za-z])(?:bc1|ltc1|BC1|LTC1)[02-9ac-hj-np-zAC-HJ-NP-Z]{6,87}(?![0-9A-Za-z])/g;

function classifyBase58(raw: string): Omit<ExtractedAddress, 'index' | 'context' | 'sentence' | 'raw'> | string {
  const payload = base58CheckDecode(raw);
  if (!payload) return 'błędna suma kontrolna base58check';
  const version = payload[0];
  const len = payload.length;
  if (len === 21 && version === 0x00) return { chain: 'BTC', address: raw, format: 'P2PKH (legacy)', validation: 'base58check OK, wersja 0x00' };
  if (len === 21 && version === 0x05) return { chain: 'BTC', address: raw, format: 'P2SH', validation: 'base58check OK, wersja 0x05' };
  if (len === 21 && version === 0x30) return { chain: 'LTC', address: raw, format: 'P2PKH', validation: 'base58check OK, wersja 0x30' };
  if (len === 21 && version === 0x32) return { chain: 'LTC', address: raw, format: 'P2SH', validation: 'base58check OK, wersja 0x32' };
  if (len === 21 && version === 0x41) return { chain: 'TRX', address: raw, format: 'TRON base58', validation: 'base58check OK, wersja 0x41' };
  return `nieobsługiwana wersja base58 (0x${version.toString(16)}, ${len} B)`;
}

/** Ekstrahuje zwalidowane adresy. Odrzuceni kandydaci są zwracani osobno (przejrzystość). */
export function extractAddresses(text: string): { found: ExtractedAddress[]; rejected: RejectedCandidate[] } {
  const found: ExtractedAddress[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const m of text.matchAll(ETH_RE)) {
    const raw = m[0];
    const status = eip55Status(raw);
    if (status === 'invalid') {
      rejected.push({ raw, reason: 'błędna suma kontrolna EIP-55 (literówka lub zmanipulowany adres)', index: m.index! });
      continue;
    }
    found.push({
      chain: 'ETH',
      address: toEip55(raw),
      raw,
      format: 'EVM (20 B)',
      index: m.index!,
      context: contextOf(text, m.index!, raw.length),
      sentence: sentenceOf(text, m.index!, raw.length),
      validation: status === 'valid' ? 'suma kontrolna EIP-55 poprawna' : 'format poprawny, brak sumy kontrolnej EIP-55 (same małe/wielkie litery)',
      evmCompatible: true,
    });
  }

  for (const m of text.matchAll(BECH32_RE)) {
    const raw = m[0];
    const dec = segwitDecode(raw);
    if (!dec) {
      rejected.push({ raw, reason: 'błędna suma kontrolna bech32/bech32m', index: m.index! });
      continue;
    }
    const chain: Chain | null = dec.hrp === 'bc' ? 'BTC' : dec.hrp === 'ltc' ? 'LTC' : null;
    if (!chain) continue;
    const format =
      dec.version === 0 ? (dec.program.length === 20 ? 'P2WPKH (SegWit v0)' : 'P2WSH (SegWit v0)') : dec.version === 1 ? 'P2TR (Taproot)' : `SegWit v${dec.version}`;
    found.push({
      chain,
      address: raw.toLowerCase(),
      raw,
      format,
      index: m.index!,
      context: contextOf(text, m.index!, raw.length),
      sentence: sentenceOf(text, m.index!, raw.length),
      validation: `${dec.version === 0 ? 'bech32' : 'bech32m'} OK`,
    });
  }

  for (const m of text.matchAll(B58_RE)) {
    const raw = m[0];
    const c = classifyBase58(raw);
    if (typeof c === 'string') {
      // Krótkie słowa zaczynające się na T/L/M to zwykle zwykły tekst – nie zaśmiecamy listy odrzuceń.
      if (/\d/.test(raw)) rejected.push({ raw, reason: c, index: m.index! });
      continue;
    }
    found.push({ ...c, raw, index: m.index!, context: contextOf(text, m.index!, raw.length), sentence: sentenceOf(text, m.index!, raw.length) });
  }

  found.sort((a, b) => a.index - b.index);
  return { found, rejected };
}

export function normalizeAddress(chain: Chain, address: string): string {
  if (chain === 'ETH') return address.toLowerCase();
  if (address.toLowerCase().startsWith('bc1') || address.toLowerCase().startsWith('ltc1')) return address.toLowerCase();
  return address;
}

/** Walidacja pojedynczego adresu podanego przez analityka jako dane wejściowe. */
export function parseSingleAddress(input: string): ExtractedAddress | null {
  const { found } = extractAddresses(input.trim());
  return found.length === 1 && found[0].raw === input.trim() ? found[0] : null;
}
