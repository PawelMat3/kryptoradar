# Krypto Radar

**Narzędzie OSINT, które łączy publiczne ślady cyfrowe osoby z adresami kryptowalutowymi i ocenia pewność tego powiązania w jawny, odtwarzalny sposób.**

HackNation 2026 · wyzwanie MF / KAS „Osintowy Łapacz Cyfrowych Śladów”

---

## 1. Problem

Osoby sprzedające kryptowaluty często nie wykazują przychodu w PIT-38, zakładając anonimowość. W praktyce publikują adresy portfeli w bio na GitHubie, w ogłoszeniach P2P, na forach i kanałach Telegrama. Analityk KAS szuka ich dziś ręcznie, a wynik trudno powtórzyć i uzasadnić.

## 2. Rozwiązanie

Analityk podaje co najmniej jeden identyfikator osoby. Krypto Radar:

1. znajduje konta osoby (Maigret) i strony z jej identyfikatorami (SearXNG),
2. pobiera i archiwizuje źródła (URL, czas, kod HTTP, SHA-256),
3. ocenia, czy każde źródło rzeczywiście należy do tej osoby,
4. wykrywa adresy krypto z walidacją sum kontrolnych,
5. odrzuca adresy giełd, kontraktów, mikserów i zbiórek,
6. analizuje transakcje i wskazuje sygnały wymiany na fiat,
7. liczy Wskaźnik Pewności z rozpisaniem każdej reguły,
8. porównuje wynik z poprzednim przebiegiem (np. podmiana adresu na profilu),
9. tworzy raport z podziałem na fakty, obliczenia i wnioski do weryfikacji.

## 3. Dane wejściowe

| Pole | Przykład | Użycie |
|---|---|---|
| Imię i nazwisko | Jan Testowy | wyszukiwarka; wykrywanie sprzecznego imienia na profilu; potwierdzenie tożsamości na stronie |
| Nick / login | kryptokowal77 | Maigret; wyszukiwarka z kontekstem krypto; dopasowanie autora wpisów na forach |
| E-mail | jan.testowy@example.com | wyszukiwarka; część lokalna jako dodatkowy nick (oznaczony jako wyprowadzony); potwierdzenie tożsamości |
| Komunikator | @kryptokowal77 | jak nick + potwierdzenie tożsamości |
| URL profilu | https://github.com/… | pobierany bezpośrednio, pewność tożsamości 1.0 |
| Adres krypto | bc1q…, 0x…, T… | walidacja, etykiety, analiza on-chain, wyszukiwanie adresu w sieci |

Wystarczy jedno pole. Każda sprawa ma tryb **demo** (syntetyczne źródła, offline) lub **live** (prawdziwy internet) i opcjonalny harmonogram (analiza co N minut).

## 4. Parametry wyszukiwania

### 4.1 Konta po nicku – Maigret 0.6.6

| Parametr | Wartość | Uzasadnienie |
|---|---|---|
| Serwisy (live) | GitHub, GitLab, Keybase, Hacker News, Telegram, Reddit (`MAIGRET_LIVE_SITES`) | serwisy, w których ludzie publikują adresy i które nie wymagają logowania |
| Serwisy (demo) | 12 serwisów syntetycznych | 5 z kontem osoby, 7 bez – pozwala zmierzyć „pospolitość” nicku |
| Rekurencja | wyłączona (`--no-recursion`) | przewidywalny, odtwarzalny zakres |
| Aktualizacja bazy | wyłączona (`--no-autoupdate`) | ta sama baza serwisów = ten sam wynik |
| Timeout | 15 s, bez ponowień | nie obciążamy serwisów |
| Kandydaci | nicki, identyfikatory komunikatorów, część lokalna e-maila (≥4 znaki), maks. 4 | |

Odsetek serwisów, na których nick istnieje, obniża pewność tożsamości, jeśli przekracza 50% (nick pospolity).

### 4.2 Wyszukiwarka – własna instancja SearXNG

| Zapytanie | Kiedy |
|---|---|
| `"Imię Nazwisko"` | podano imię i nazwisko |
| `"Imię Nazwisko" (bitcoin OR ethereum OR BTC OR ETH OR USDT OR portfel OR wallet)` | live |
| `"e-mail"` | podano e-mail |
| `"nick" (bitcoin OR … OR wallet)` | live, dla każdego nicku |
| `"komunikator" (bitcoin OR … OR wallet)` | live |
| adres krypto | podano adres |

- Silniki: Google, Bing, Brave, Mojeek, Startpage. DuckDuckGo jest wyłączony, bo blokuje automaty (CAPTCHA).
- **Filtr trafności:** wynik zostaje, jeśli URL, tytuł lub opis zawiera wszystkie słowa identyfikatora (dowolna kolejność, bez polskich znaków). Odrzuca typowe „śmieci” silników ignorujących cudzysłów.
- Maks. 10 wyników na zapytanie.
- Wyniki z Instagrama, Facebooka, X, LinkedIna, TikToka, Threads i Snapchata są pomijane, bo wymagają logowania.

### 4.3 Pobieranie i przechodzenie po linkach

| Parametr | Wartość |
|---|---|
| Maks. stron na przebieg | 40 (`FETCH_MAX_PAGES`) |
| Głębokość | 2 (profil → link → strona) |
| Opóźnienie na host | 300 ms; po HTTP 429 host jest pomijany do końca przebiegu |
| Timeout / rozmiar | 15 s / 2 MB |
| robots.txt | respektowany |
| Linki do innych serwisów | tylko do serwisów z rejestru źródeł, bez nawigacji (logowanie, regulaminy, pomoc, strona główna) |
| Linki w tym samym serwisie | tylko wątki (serwisy z wpisami) lub adresy zawierające nick osoby |
| Strony z wyszukiwarki | nie prowadzą dalej |
| Ruch wychodzący | allowlista hostów; w trybie `EGRESS_OPEN_WEB` dowolne publiczne strony, adresy prywatne i wewnętrzne zawsze blokowane (także po przekierowaniu) |
| GitHub | API (profil + README profilu), opcjonalny `GITHUB_TOKEN` |

### 4.4 Wykrywanie adresów

| Sieć | Format | Walidacja |
|---|---|---|
| Bitcoin | P2PKH, P2SH, P2WPKH, P2WSH, P2TR | base58check, bech32, bech32m |
| Ethereum / EVM | 0x + 40 hex | EIP-55 (keccak-256); małe litery akceptowane, mieszane z błędem odrzucane |
| TRON | T… | base58check, wersja 0x41 |
| Litecoin | L…, M…, ltc1… | base58check, bech32 |

Skróty transakcji (64 hex) nie są mylone z adresami. Odrzuceni kandydaci (np. literówki) są pokazywani w raporcie.

## 5. Wskaźnik Pewności

```
wystąpienie = clamp(baza + kontekst, 0, 100) × T
wynik       = min(100, max(wystąpienie) + 15 · [≥2 niezależne źródła] + 10 · [przepływ on-chain z adresem ≥80%])
```

| Kategoria źródła | Baza |
|---|---|
| Własny profil (GitHub, zweryfikowane konto) | 90 |
| Osobista strona WWW | 85 |
| Repozytorium kodu | 80 |
| Ogłoszenie P2P / sprzedaż | 70 |
| Komunikator w kontekście rozliczenia, stopka e-mail | 65 |
| Forum | 50 |
| Inna strona | 40 |
| Giveaway / masowe komentarze | 20 |

**Kontekst** (tylko zdanie z adresem): własność („mój portfel”, „wpłaty na”, „donate”) +5, sprzedaż („sprzedam”, „cena”, „PLN”) +5, cudzy adres („adres giełdy”, „wysyłam na binance”, „kontrakt”, „oszust”) −25, cytat −20.

**T – pewność, że źródło należy do osoby:**

| Reguła | Wartość |
|---|---|
| URL wskazany przez analityka | 1.0 |
| Link z profilu osoby | do 0.85 (tyle, ile profil linkujący) |
| Konto o tym samym nicku | 0.6 |
| Wynik wyszukiwarki | 0.4 |
| Na stronie imię / e-mail / komunikator osoby | +0.15 każdy |
| Strona linkuje do innego profilu osoby | +0.1 |
| Nick pospolity (≥50% serwisów) | −0.2 |
| Bardzo krótki nick (≤4 znaki) | −0.15 |
| Profil deklaruje inne imię i nazwisko | −0.35 |

Synergia liczy się tylko dla źródeł z różnych serwisów i z T ≥ 0.5. Wiele wystąpień w jednym serwisie nie jest dodatkowym potwierdzeniem.

## 6. Odrzucanie błędnych przypisań

1. **Walidacja kryptograficzna** – literówki i losowe ciągi nie są adresami.
2. **Rejestr etykiet** – giełdy (Binance, Kraken, Coinbase, OKX, Bitfinex), kontrakty tokenów (USDT, USDC), routery DEX (Uniswap, 1inch), miksery (Tornado Cash), zbiórki. Wynik 0%, interakcja jest odnotowana.
3. **Bytecode** – `eth_getCode ≠ 0x` oznacza smart kontrakt, nawet bez etykiety.
4. **Tagi eksploratora** – nazwy z Blockscout (np. „Binance: Hot Wallet”).
5. **Autorstwo wpisów** – w wątku przypisujemy tylko wpisy autora będącego badaną osobą.
6. **Ocena tożsamości** – ten sam nick u innej osoby daje niski wynik.
7. **Wykrywanie giveawayów** – ≥8 wpisów z adresami od ≥6 autorów zmienia kategorię na masowe komentarze.

## 7. Aktywność blockchain i cash-out

Dane: Blockscout (Ethereum, wraz z transferami ERC-20) i mempool.space (Bitcoin). Obie usługi są open source i można je hostować samodzielnie.

| Wskaźnik | Reguła |
|---|---|
| `CEX_DEPOSIT` | wypływ na adres giełdy lub portfela powierniczego |
| `OFFRAMP_GATEWAY` | wypływ do bramki płatniczej / dostawcy karty krypto |
| `P2P_SERVICE` | transakcja z usługą P2P / escrow |
| `STABLECOIN_SWAP` | wypływ do DEX i wpływ stablecoina w ciągu 24 h lub duży wpływ stablecoina |
| `MIXER` | transakcja z mikserem |
| `CEX_WITHDRAWAL` | wpływ z giełdy (zakup, koszt nabycia) |
| `HIGH_VOLUME` | wypływy powyżej progów (5 ETH, 0.25 BTC, 5000 USDT/USDC) |

Metryki: liczba transakcji, okres aktywności, wpływy i wypływy per aktywo, kontrahenci według kategorii, chronologia przepływów.

## 8. Raport i odtwarzalność

- HTML (druk do PDF) i JSON.
- Każdy wynik ma tabelę reguł i wystąpienia z kontekstem oraz kopią archiwalną strony.
- Wnioski są podzielone na **FAKT** (ze źródła), **OBLICZENIE** (algorytm) i **WNIOSEK** (do weryfikacji, np. „zapytanie do VASP o KYC”).
- Zapisywane są: URL, czas pobrania, kod HTTP, SHA-256, sposób odkrycia źródła, wersje narzędzi, parametry przebiegu i pełny dziennik zapytań.
- Kolejne przebiegi są porównywane: nowe i usunięte adresy, zmiany wyniku, nowe źródła, podmiana adresu na profilu.

## 9. Architektura i wdrożenie

| Komponent | Technologia |
|---|---|
| API i potok analizy | Node.js 22, TypeScript, Fastify |
| Baza | PostgreSQL 16 |
| Interfejs | React 18, Vite, nginx |
| Konta po nicku | Python, FastAPI, Maigret |
| Wyszukiwarka | SearXNG |
| AI (opcjonalnie) | dowolne API zgodne z OpenAI, np. lokalna Ollama; tylko streszczenie, bez wpływu na wynik |

Całość uruchamia `docker compose up -d --build`, lokalnie lub na serwerze (Ubuntu). Baza i syntetyczne źródła działają w sieci Docker bez dostępu do internetu. Panel nasłuchuje tylko na `127.0.0.1`. Rozbudowa: nowe źródło to wpis w `sources.json`, nowe etykiety to plik JSON, nowa sieć to klasa `ChainProvider`.

## 10. Testy

- 31 testów jednostkowych: walidacja adresów (w tym prawdziwe adresy giełd), punktacja, tożsamość, cash-out, porównania, ochrona SSRF.
- Scenariusz akceptacyjny na danych syntetycznych (`scenarios/demo-kowal.json`, `scripts/acceptance.mjs`): 21 sprawdzeń obejmujących cały wymagany przebieg – od danych wejściowych, przez wykluczenia i cash-out, po podmianę adresu między przebiegami. Wynik: 21/21.

## 11. Ograniczenia

- Serwisy wymagające logowania są poza zakresem (zgodnie z zasadami OSINT).
- Strony renderowane wyłącznie JavaScriptem nie są pobierane (do dodania: przeglądarka headless).
- Etykiety BTC są ograniczone; kolejny krok to import otwartych zbiorów etykiet i klastrowanie adresów.
- Wynik wyszukiwarek zależy od limitów zapytań silników.
