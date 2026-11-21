import { describe, expect, it } from 'vitest';
import { extractAddresses, parseSingleAddress } from '../src/core/addresses/extract.js';
import { extractIdentifiers } from '../src/core/identifiers.js';

const REAL = {
  // Powszechnie znane adresy publiczne (etykiety giełd/kontraktów) – testy walidacji sum kontrolnych.
  binance14: '0x28C6c06298d514Db089934071355E5743bf21d60',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  genesis: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  binanceCold: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
  bitfinexCold: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97',
  usdtTron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  taproot: 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
};

describe('ekstrakcja adresów', () => {
  it('wykrywa adresy BTC (legacy, P2SH, SegWit, Taproot), ETH i TRON w tekście', () => {
    const text = `Wpłaty: ${REAL.genesis}, multisig ${REAL.binanceCold}; segwit ${REAL.bitfinexCold}. Taproot: ${REAL.taproot}.
      ETH: ${REAL.binance14} oraz TRC20 ${REAL.usdtTron}`;
    const { found } = extractAddresses(text);
    const byRaw = Object.fromEntries(found.map((f) => [f.raw, f]));
    expect(byRaw[REAL.genesis].chain).toBe('BTC');
    expect(byRaw[REAL.genesis].format).toContain('P2PKH');
    expect(byRaw[REAL.binanceCold].format).toBe('P2SH');
    expect(byRaw[REAL.bitfinexCold].format).toContain('P2WSH');
    expect(byRaw[REAL.taproot].format).toContain('Taproot');
    expect(byRaw[REAL.binance14].chain).toBe('ETH');
    expect(byRaw[REAL.usdtTron].chain).toBe('TRX');
    expect(found).toHaveLength(6);
  });

  it('odrzuca adres ETH z błędną sumą kontrolną EIP-55 (literówka)', () => {
    const typo = REAL.binance14.replace('C6c', 'c6c');
    const { found, rejected } = extractAddresses(`portfel ${typo}`);
    expect(found).toHaveLength(0);
    expect(rejected[0].reason).toContain('EIP-55');
  });

  it('akceptuje adres ETH bez sumy kontrolnej (same małe litery) i normalizuje go', () => {
    const { found } = extractAddresses(`adres ${REAL.usdt.toLowerCase()}`);
    expect(found[0].address).toBe(REAL.usdt);
    expect(found[0].validation).toContain('brak sumy kontrolnej');
  });

  it('odrzuca BTC z uszkodzoną sumą kontrolną base58check i bech32', () => {
    const badB58 = REAL.genesis.slice(0, -1) + 'b';
    const badBech = REAL.bitfinexCold.slice(0, -1) + 'q';
    const { found, rejected } = extractAddresses(`${badB58} ${badBech}`);
    expect(found).toHaveLength(0);
    expect(rejected.map((r) => r.reason).join()).toMatch(/base58check|bech32/);
  });

  it('nie myli skrótu transakcji (64 hex) z adresem ETH', () => {
    const txHash = '0x' + 'ab'.repeat(32);
    expect(extractAddresses(`tx ${txHash}`).found).toHaveLength(0);
  });

  it('nie traktuje zwykłych słów jako adresów', () => {
    const { found } = extractAddresses('To jest Tekst o Litecoinie, Monero i Tronie bez adresów. MMMMMMMMMMMMMMMMMMMMMMMMMMMM');
    expect(found).toHaveLength(0);
  });

  it('zwraca kontekst wystąpienia', () => {
    const { found } = extractAddresses(`Mój portfel do donacji: ${REAL.binance14} – dzięki!`);
    expect(found[0].context).toContain('Mój portfel do donacji');
  });

  it('parseSingleAddress waliduje pojedynczy adres wejściowy', () => {
    expect(parseSingleAddress(REAL.bitfinexCold)?.chain).toBe('BTC');
    expect(parseSingleAddress('xyz')).toBeNull();
  });
});

describe('identyfikatory Web2', () => {
  it('wyciąga e-mail, Telegram i ENS', () => {
    const ids = extractIdentifiers('Kontakt: jan.testowy@example.com, TG: https://t.me/kryptokowal77, ENS: kowal.eth');
    expect(ids).toEqual(
      expect.arrayContaining([
        { type: 'email', value: 'jan.testowy@example.com' },
        { type: 'telegram', value: 'kryptokowal77' },
        { type: 'ens', value: 'kowal.eth' },
      ]),
    );
  });
});
