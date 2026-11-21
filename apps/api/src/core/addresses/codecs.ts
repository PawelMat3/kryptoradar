// Kodeki i walidacja sum kontrolnych adresów kryptowalutowych.
// Walidacja kryptograficzna (a nie sam regex) eliminuje większość fałszywych trafień
// typu losowe ciągi znaków, skróty transakcji czy identyfikatory.
import { createHash } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58].map((c, i) => [c, BigInt(i)]));

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());

export function base58Decode(s: string): Uint8Array | null {
  let num = 0n;
  for (const c of s) {
    const v = B58_MAP.get(c);
    if (v === undefined) return null;
    num = num * 58n + v;
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = B58[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** Zwraca payload (z bajtem wersji) jeśli suma kontrolna base58check się zgadza. */
export function base58CheckDecode(s: string): Uint8Array | null {
  const raw = base58Decode(s);
  if (!raw || raw.length < 5) return null;
  const payload = raw.slice(0, -4);
  const checksum = raw.slice(-4);
  const h = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) if (h[i] !== checksum[i]) return null;
  return payload;
}

export function base58CheckEncode(payload: Uint8Array): string {
  const h = sha256(sha256(payload));
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(h.slice(0, 4), payload.length);
  return base58Encode(full);
}

// ---- Bech32 / Bech32m (BIP-173 / BIP-350) ----
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const r: number[] = [];
  for (const c of hrp) r.push(c.charCodeAt(0) >> 5);
  r.push(0);
  for (const c of hrp) r.push(c.charCodeAt(0) & 31);
  return r;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || (acc << (to - bits)) & maxv) {
    return null;
  }
  return ret;
}

export interface SegwitDecoded {
  hrp: string;
  version: number;
  program: Uint8Array;
}

/** Dekoduje adres segwit (bech32 dla v0, bech32m dla v1+). Zwraca null przy błędnej sumie. */
export function segwitDecode(addr: string): SegwitDecoded | null {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return null; // mieszana wielkość liter zabroniona
  const s = addr.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length || s.length > 90) return null;
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (const c of s.slice(pos + 1)) {
    const d = BECH32_CHARSET.indexOf(c);
    if (d === -1) return null;
    data.push(d);
  }
  const pm = polymod([...hrpExpand(hrp), ...data]);
  const version = data[0];
  if (version === undefined || version > 16) return null;
  const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
  if (pm !== expected) return null;
  const prog = convertBits(data.slice(1, -6), 5, 8, false);
  if (!prog || prog.length < 2 || prog.length > 40) return null;
  if (version === 0 && prog.length !== 20 && prog.length !== 32) return null;
  return { hrp, version, program: new Uint8Array(prog) };
}

export function segwitEncode(hrp: string, version: number, program: Uint8Array): string {
  const data = [version, ...(convertBits([...program], 8, 5, true) ?? [])];
  const constant = version === 0 ? BECH32_CONST : BECH32M_CONST;
  const pm = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ constant;
  const checksum = Array.from({ length: 6 }, (_, i) => (pm >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join('');
}

// ---- Ethereum EIP-55 ----
export function toEip55(addr: string): string {
  const lower = addr.toLowerCase().replace(/^0x/, '');
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

export type Eip55Status = 'valid' | 'no-checksum' | 'invalid';

export function eip55Status(addr: string): Eip55Status {
  const body = addr.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return 'no-checksum';
  return toEip55(addr) === addr ? 'valid' : 'invalid';
}
