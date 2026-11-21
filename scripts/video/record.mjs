// Automatyczne nagranie demo Krypto Radar: Playwright + Chrome, widoczny kursor, napisy w obrazie.
import { chromium } from 'playwright-core';
import { writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:18080';
const OUT = process.cwd();
const W = 1440, H = 810;
const CARD = pathToFileURL(join(OUT, 'card.html')).href;

const overlay = () => {
  const css = `
    #__cur{position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;z-index:2147483647;pointer-events:none;transition:transform .05s}
    #__cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
    .__ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #1d4f80;border-radius:50%;z-index:2147483646;pointer-events:none;animation:__r .5s ease-out forwards}
    @keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #__cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1180px;padding:10px 20px;border-radius:6px;
      background:rgba(18,22,29,.86);color:#fff;font:500 23px/1.35 'Segoe UI',system-ui,sans-serif;text-align:center;z-index:2147483645;pointer-events:none}
    #__cap:empty{display:none}
    .__hl{outline:3px solid #e0a100 !important;outline-offset:3px !important;border-radius:4px}`;
  const add = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.5 19 L10.5 12.8 L16.5 12.8 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div');
    cap.id = '__cap';
    cap.textContent = window.__capText || '';
    document.body.appendChild(cap);
    const pos = window.__pos || { x: 1380, y: 770 };
    c.style.left = pos.x + 'px';
    c.style.top = pos.y + 'px';
  };
  window.__setCap = (t) => {
    window.__capText = t;
    const el = document.getElementById('__cap');
    if (el) el.textContent = t;
  };
  document.addEventListener('mousemove', (e) => {
    window.__pos = { x: e.clientX, y: e.clientY };
    const c = document.getElementById('__cur');
    if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }
  }, true);
  document.addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.className = '__ring';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'pl-PL', recordVideo: { dir: OUT, size: { width: W, height: H } } });
await ctx.addInitScript(overlay);
const page = await ctx.newPage();
const t0 = Date.now();
const cues = [];
let current = null;
const sleep = (ms) => page.waitForTimeout(ms);
let mouse = { x: 720, y: 400 };

async function cap(text) {
  const t = (Date.now() - t0) / 1000;
  if (current) current.end = t;
  current = text ? { start: t, end: null, text } : null;
  if (current) cues.push(current);
  await page.evaluate((x) => window.__setCap?.(x), text ?? '');
}
async function reapplyCap() {
  await page.evaluate((x) => window.__setCap?.(x), current?.text ?? '');
}
async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  mouse = { x, y };
  await sleep(180);
}
async function click(locator, highlight = true) {
  await moveTo(locator);
  if (highlight) await locator.evaluate((el) => el.classList.add('__hl'));
  await sleep(350);
  await page.mouse.down();
  await page.mouse.up();
  await locator.evaluate((el) => el.classList.remove('__hl'), undefined, { timeout: 300 }).catch(() => {});
  await sleep(500);
}
async function type(locator, text) {
  await click(locator, false);
  await locator.pressSequentially(text, { delay: 55 });
  await sleep(350);
}
async function scrollBy(dy, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await sleep(40);
  }
  await sleep(400);
}
async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await reapplyCap();
}
const card = (t, s, m) => `${CARD}?t=${encodeURIComponent(t)}&s=${encodeURIComponent(s)}&m=${encodeURIComponent(m)}`;

// ---- 0. Plansza tytułowa
await goto(card('Krypto Radar', 'Narzędzie OSINT: ślady cyfrowe osoby → adresy kryptowalutowe → sygnały wymiany na fiat.', 'HackNation 2026 · wyzwanie MF / KAS · demo na danych syntetycznych'));
await cap('');
await sleep(4500);

// ---- 1. Nowa analiza
await goto(`${BASE}/?v=${Date.now()}#/new`);
await cap('Analityk podaje identyfikatory osoby – wystarczy jeden. Tu: fikcyjna osoba z trybu demo.');
await sleep(1200);
await click(page.getByRole('radio', { name: 'Demo' }));
await type(page.locator('label:has-text("Nazwa sprawy") + input'), 'Demo – Jan Testowy');
await type(page.locator('label:has-text("Imię i nazwisko") + input'), 'Jan Testowy');
await type(page.locator('label:has-text("Nicki") + textarea'), 'kryptokowal77');
await type(page.locator('label:has-text("E-mail") + textarea'), 'jan.testowy@example.com');
await cap('Tryb Demo działa na syntetycznych źródłach. Tryb Live – na prawdziwym internecie.');
await sleep(3800);
await cap('Maigret szuka kont po nicku, wyszukiwarka – stron z identyfikatorami. Każde źródło jest archiwizowane (URL, czas, SHA-256).');
await click(page.getByRole('button', { name: 'Uruchom', exact: true }));
await page.waitForURL((u) => u.hash.startsWith('#/run/'), { waitUntil: 'commit' });

// ---- 2. Przebieg
await page.getByText('zakończony').first().waitFor({ timeout: 60000 });
const runUrl = page.url();
await sleep(2500);
await cap('Potem: tożsamość źródeł, wykrycie adresów, weryfikacja, analiza blockchain i Wskaźnik Pewności.');
await page.mouse.move(700, 600, { steps: 20 });
await scrollBy(300);
await sleep(2500);
await scrollBy(-300);

// ---- 3. Adresy
await click(page.getByRole('tab', { name: /^Adresy/ }));
await cap('Adres ETH znaleziony w 3 niezależnych źródłach: profil, strona osobista, ogłoszenie P2P → 100%.');
await sleep(3200);
await scrollBy(330);
await cap('Każdy wynik ma rozpisane reguły: baza za typ źródła, kontekst zdania, T – czy źródło należy do osoby, synergia.');
await moveTo(page.getByText('IDENTITY_FACTOR').first());
await sleep(3800);
await cap('Każde wystąpienie: zdanie z adresem, autor wpisu i kopia archiwalna strony.');
await moveTo(page.getByText('kopia archiwalna').first());
await sleep(3200);
await scrollBy(520);
await cap('Ten sam nick w innym serwisie, ale profil innej osoby („Piotr Inny”) → tylko 24%. Giveaway → 17%.');
await moveTo(page.getByText('24%').first());
await sleep(4200);
await page.mouse.move(700, 300, { steps: 15 });
await scrollBy(-2000, 16);

// ---- 4. Odrzucone
await click(page.getByRole('tab', { name: /^Odrzucone/ }));
await cap('Odrzucone przypisania: adres giełdy Binance, kontrakt USDT i kontrakt rozpoznany po bytecode → 0%.');
await sleep(4200);
await scrollBy(260);
await cap('Adresy innych autorów w tym samym wątku i adres z literówką (zła suma kontrolna) nie trafiają do osoby.');
await sleep(4200);
await scrollBy(-1500, 10);

// ---- 5. Blockchain
await click(page.getByRole('tab', { name: /^Blockchain/ }));
await cap('Analiza transakcji przypisanych adresów i sygnały wyjścia do fiat.');
await sleep(2000);
const ethPanel = page.locator('.panel', { hasText: '0x487640ECda7BC1d0291C68548d716678Ce7491De' }).first();
await ethPanel.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(900);
await cap('ETH → USDT przez Uniswap, wpłata na Binance, escrow P2P, bramka karty krypto. Każdy wskaźnik wskazuje transakcje.');
await moveTo(ethPanel.getByText('CEX_DEPOSIT').first());
await sleep(4500);
await ethPanel.getByText('Chronologia przepływów').evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(900);
await cap('Chronologia przepływów z kontrahentami oznaczonymi w rejestrze etykiet.');
await page.mouse.move(760, 420, { steps: 18 });
await sleep(3500);

// ---- 6. Zmiany w czasie
await page.mouse.move(700, 200, { steps: 12 });
await scrollBy(-3000, 14);
await click(page.locator('.muted.small a').nth(1));
await cap('Analizy można powtarzać cyklicznie. Symulujemy zmianę: osoba podmienia adres na profilu.');
await sleep(1500);
await click(page.locator('.segmented button', { hasText: 'v2' }));
await click(page.getByRole('button', { name: 'Uruchom ponownie' }));
await page.waitForURL((u) => u.hash.startsWith('#/run/'), { waitUntil: 'commit' });
await page.getByText('zakończony').first().waitFor({ timeout: 60000 });
await sleep(1200);
await click(page.getByRole('tab', { name: /^Zmiany/ }));
await cap('Kolejny przebieg wykrywa podmianę adresu na tym samym profilu.');
await sleep(4200);
await click(page.getByRole('tab', { name: /^Graf/ }));
await scrollBy(180);
await cap('Graf powiązań: identyfikator → źródło → adres → giełda. Nowy adres: 80% dzięki przelewowi ze starego.');
await page.mouse.move(820, 420, { steps: 20 });
await sleep(5500);

// ---- 7. Raport
const runId = page.url().split('/run/')[1]?.split('?')[0];
await goto(`${BASE}/api/runs/${runId}/report.html`);
await cap('Raport HTML / PDF: fakty, wyniki obliczeń i wnioski do weryfikacji – oddzielnie.');
await sleep(3000);
await page.mouse.move(700, 400, { steps: 10 });
await scrollBy(900);
await sleep(1500);
const facts = page.getByText('7. Fakty, obliczenia i wnioski');
await facts.scrollIntoViewIfNeeded();
await sleep(3000);
const src = page.getByText('8. Źródła');
await src.scrollIntoViewIfNeeded();
await cap('Źródła z czasem pobrania i SHA-256, wersje narzędzi i dziennik zapytań – analizę można odtworzyć.');
await sleep(4200);

// ---- 8. Plansza końcowa
await goto(card('Krypto Radar', 'Open source · docker compose · bez chmury publicznej · scenariusz testowy 21/21', 'github.com/PawelMat3/kryptoradar'));
await cap('');
await sleep(4500);

const total = (Date.now() - t0) / 1000;
if (current) current.end = total;
const video = page.video();
await ctx.close();
await browser.close();
const path = await video.path();
renameSync(path, join(OUT, 'raw.webm'));
writeFileSync(join(OUT, 'cues.json'), JSON.stringify({ total, runUrl, cues }, null, 2));
console.log('total', total.toFixed(1), 's, cues', cues.length);
