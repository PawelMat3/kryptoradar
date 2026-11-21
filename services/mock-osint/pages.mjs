// SYNTETYCZNY zbiór źródeł OSINT do scenariuszy testowych. Osoba „Jan Testowy” (nick kryptokowal77)
// jest fikcyjna, a adresy wygenerowano deterministycznie z jawnych ziaren (apps/api/scripts).
import { createHash } from 'node:crypto';

export const ADDR = {
  ETH_MAIN: '0x487640ECda7BC1d0291C68548d716678Ce7491De',
  ETH_NEW: '0xcf948D1ab769B8ce89460E98c916B167CbCE78a8',
  ETH_GIVEAWAY: '0x3dE42CF06DbCa3c57389724b2FBfca40F9B87637',
  ETH_GAMEHUB_OTHER: '0x510f54a6551a0f8687C3B02cCa21f35474cE0e65',
  ETH_FORUM_OTHER1: '0x4437BC57df45449f8370da5c50D0064603ecB44E',
  ETH_SYNTH_CONTRACT: '0x93f8035d02E816C1d36491BBeD588B00C6030b0b',
  BTC_MAIN: 'bc1ql5fslaa77sx0xsj93cx5alz84f3vc6fx05erpe',
  BTC_OTHER: 'bc1q2vqs8srnkx6ylqjchuty0ju8vfg4akhwhny42p',
  TRX_MAIN: 'TMPwAxjCpL7FRJwpUaFvGGdycdG9K1H3P8',
  // prawdziwe, publicznie znane adresy usług (do testu wykluczeń)
  BINANCE14: '0x28C6c06298d514Db089934071355E5743bf21d60',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};
// Adres z celowo uszkodzoną sumą kontrolną EIP-55 (zmieniona wielkość przedostatniej litery: "De" → "de").
ADDR.ETH_TYPO = ADDR.ETH_MAIN.slice(0, -2) + ADDR.ETH_MAIN.slice(-2).toLowerCase();

const lowerEth = (seed) => '0x' + createHash('sha256').update('giveaway:' + seed).digest('hex').slice(0, 40);

const layout = (title, body, extraHead = '') =>
  `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${title}</title>${extraHead}<style>body{font-family:sans-serif;max-width:760px;margin:24px auto;padding:0 12px}.post,.listing,.msg{border:1px solid #ccc;padding:8px;margin:8px 0}.author,.seller,.from{font-weight:bold}</style></head><body>${body}</body></html>`;

export function buildSite(version) {
  const devhubAddr = version >= 2 ? ADDR.ETH_NEW : ADDR.ETH_MAIN;
  const giveawayAuthors = ['ola_k', 'mietek99', 'cryptozenon', 'basia.b', 'hodler_pl', 'tomek_t', 'xX_ania_Xx', 'grzegorz77', 'kasia_k', 'luckyduck'];

  return {
    'devhub.test': {
      '/kryptokowal77': layout(
        'kryptokowal77 · DevHub',
        `<h1><span itemprop="name">Jan Testowy</span> <small>@kryptokowal77</small></h1>
<p class="bio">Backend developer, Kraków. Open source, Rust i Solidity.</p>
<p>Jeśli chcesz wesprzeć moje projekty – mój portfel ETH do donacji: <code>${devhubAddr}</code></p>
<ul>
  <li>Strona: <a href="http://jan-testowy.test/">jan-testowy.test</a></li>
  <li>Kanał: <a href="http://tg.test/s/kryptokowal77">t.me/kryptokowal77</a></li>
  <li>Forum: <a href="http://forum.test/user/kryptokowal77">KryptoForum</a></li>
</ul>
<h2>README: token-tools</h2>
<pre>Przykład integracji z kontraktem USDT: ${ADDR.USDT}
Router używany w testach: zobacz dokumentację protokołu.</pre>`,
      ),
    },
    'jan-testowy.test': {
      '/': layout(
        'Jan Testowy – blog',
        `<h1>Jan Testowy</h1><p>Piszę o programowaniu i kryptowalutach.</p>
<p>Kontakt: <a href="mailto:jan.testowy@example.com">jan.testowy@example.com</a></p>
<p>Podoba Ci się blog? Wpłaty na mój adres ETH: <a href="ethereum:${ADDR.ETH_MAIN}">${ADDR.ETH_MAIN}</a></p>
<p>Mój kod: <a href="http://devhub.test/kryptokowal77">DevHub</a></p>`,
      ),
    },
    'p2p.test': {
      '/user/kryptokowal77': layout(
        'Ogłoszenia użytkownika kryptokowal77 – P2P Market',
        `<h1>Ogłoszenia: kryptokowal77</h1>
<div class="listing"><span class="seller">kryptokowal77</span><div class="body">Sprzedam 0,05 BTC za PLN (przelew lub gotówka, Kraków). Płatność na adres: ${ADDR.BTC_MAIN}. Kontakt TG @kryptokowal77.</div></div>
<div class="listing"><span class="seller">kryptokowal77</span><div class="body">Sprzedam 2000 USDT (ERC-20), cena 4,05 zł/szt. Zwrot/rozliczenie na mój adres ${ADDR.ETH_MAIN}.</div></div>
<p>Kontakt ze sprzedawcą: <a href="http://tg.test/s/kryptokowal77">Telegram</a></p>`,
      ),
    },
    'forum.test': {
      '/user/kryptokowal77': layout(
        'Profil kryptokowal77 – KryptoForum',
        `<h1>kryptokowal77</h1><p>Na forum od 2021. Posty: 214.</p>
<ul><li><a href="/thread/101">Gdzie najlepiej wypłacić do PLN?</a></li><li><a href="/thread/giveaway-2025">GIVEAWAY 1 ETH</a></li></ul>`,
      ),
      '/thread/101': layout(
        'Gdzie najlepiej wypłacić do PLN? – KryptoForum',
        `<h1>Gdzie najlepiej wypłacić do PLN?</h1>
<div class="post"><span class="author">satoshi_fan</span><div class="content">Ja wysyłam wszystko na Binance, ich hot wallet to np. ${ADDR.BINANCE14}.</div></div>
<div class="post"><span class="author">kryptokowal77</span><div class="content">U mnie głównie przez P2P – ostatnio sprzedawałem na p2p.test, wpłaty na ${ADDR.BTC_MAIN}. Większe kwoty wysyłam na binance: ${ADDR.BINANCE14}.</div></div>
<div class="post"><span class="author">anon_trader</span><div class="content">Kto kupi ETH? Mój adres ${ADDR.ETH_FORUM_OTHER1}</div></div>
<div class="post"><span class="author">kryptokowal77</span><div class="content"><blockquote>anon_trader: wysłałem już na ${ADDR.BTC_OTHER}</blockquote>Ok, potwierdzam. PS stary adres z ogłoszenia miał literówkę: ${ADDR.ETH_TYPO}</div></div>
<div class="post"><span class="author">kryptokowal77</span><div class="content">Testowałem też własny kontrakt escrow pod ${ADDR.ETH_SYNTH_CONTRACT}.</div></div>`,
      ),
      '/thread/giveaway-2025': layout(
        'GIVEAWAY 1 ETH – wpisz adres! – KryptoForum',
        `<h1>GIVEAWAY 1 ETH – wpisz swój adres, losujemy w piątek!</h1>
${giveawayAuthors.map((a) => `<div class="post"><span class="author">${a}</span><div class="content">biorę udział ${lowerEth(a)}</div></div>`).join('\n')}
<div class="post"><span class="author">kryptokowal77</span><div class="content">też się zapisuję ${ADDR.ETH_GIVEAWAY}</div></div>`,
      ),
    },
    'tg.test': {
      '/s/kryptokowal77': layout(
        'kryptokowal77 – kanał Telegram (podgląd publiczny)',
        `<h1>@kryptokowal77</h1>
<div class="msg"><span class="from">kryptokowal77</span><div class="text">Rozliczenie za zamówienie #42: płatność USDT TRC-20 na ${ADDR.TRX_MAIN}.</div></div>
<div class="msg"><span class="from">kryptokowal77</span><div class="text">Nowe ogłoszenia na p2p.test – zapraszam.</div></div>`,
      ),
    },
    'gamehub.test': {
      '/u/kryptokowal77': layout(
        'kryptokowal77 – GameHub',
        `<h1><span itemprop="name">Piotr Inny</span> (kryptokowal77)</h1><p>Gram w strategie, Wrocław. Donate na stream: ${ADDR.ETH_GAMEHUB_OTHER}</p>`,
      ),
    },
  };
}

export const ROBOTS = 'User-agent: *\nDisallow: /private/\n';
