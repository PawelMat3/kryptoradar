# Film – scenariusz (maks. 3:00)

Narracja ma ok. 380 słów, czyli ok. 2:50 przy spokojnym tempie. Tekst w cudzysłowie czytasz, w nawiasach kwadratowych jest to, co robisz na ekranie.

## Przygotowanie (przed nagraniem)

1. Tunel do serwera: `ssh -N -L 8080:127.0.0.1:8080 root@<serwer>`, potem http://localhost:8080.
2. Profil demo w wersji 1: otwórz dowolną sprawę demo i kliknij **v1** przy „Profil DevHub” (albo `curl -X POST localhost:8080/api/demo/profile-version -H "content-type: application/json" -d "{\"version\":1}"`).
3. Usuń stare sprawy testowe, żeby lista była czysta.
4. Przeglądarka: okno 1920×1080, zoom 110%, bez zakładek i rozszerzeń w pasku. Tryb jasny.
5. W drugiej karcie otwórz slajd 1 prezentacji (PDF), w trzeciej README na GitHubie.
6. Nagrywanie: OBS Studio, 1080p, 30 kl./s, mikrofon bez szumów. Najpierw próba na sucho ze stoperem.

## Scenariusz

| Czas | Ekran | Narracja |
|---|---|---|
| 0:00–0:15 | [Slajd 1 z PDF] | „Krypto Radar to narzędzie OSINT dla KAS. Łączy publiczne ślady osoby – nick, e-mail, profil – z adresami kryptowalutowymi, liczy jawny Wskaźnik Pewności i pokazuje sygnały wymiany krypto na złotówki.” |
| 0:15–0:35 | [Aplikacja → **Nowa analiza** → **Demo** → **Wypełnij danymi demo** → pokaż pola → **Uruchom**] | „Pokażę pełny przebieg na danych syntetycznych. Fikcyjna osoba: Jan Testowy, nick kryptokowal77 i e-mail. Wystarczy jeden identyfikator. Tryb live działa tak samo na prawdziwym internecie.” |
| 0:35–0:50 | [Zakładka **Przebieg** – kroki się zielenią] | „Maigret szuka kont po nicku, wyszukiwarka – stron z identyfikatorami. Każda strona jest archiwizowana z adresem URL, czasem i skrótem SHA-256.” |
| 0:50–1:25 | [**Adresy** → rozwinięty adres ETH 100% → pokaż tabelę reguł, potem wystąpienia i link „kopia archiwalna” → przewiń do 68% BTC i 24% ETH] | „Adres ETH znaleźliśmy w trzech niezależnych źródłach: na profilu, na stronie osobistej i w ogłoszeniu P2P. Tu widać, jak policzono wynik: baza za typ źródła, kontekst zdania – ‘mój portfel’ – i współczynnik T, czyli czy to źródło naprawdę należy do tej osoby. Za trzy niezależne źródła jest premia. Tu ważny przykład: ten sam nick na GameHub, ale profil deklaruje inną osobę – wynik spada do 24 procent.” |
| 1:25–1:45 | [**Odrzucone**] | „Narzędzie odrzuca błędne przypisania: adres Binance wspomniany w poście, kontrakt USDT z README i kontrakt rozpoznany po bytecode – wszystkie mają zero procent. Adresy innych uczestników wątku i adres z literówką też nie trafiają do osoby.” |
| 1:45–2:10 | [**Blockchain** → przewiń do ETH, pokaż wskaźniki i chronologię] | „Dla przypisanych adresów analizujemy transakcje. Tu widać wymianę ETH na USDT przez Uniswap, wpłatę USDT na Binance, płatność przez escrow P2P i bramkę karty krypto. Każdy wskaźnik wskazuje konkretne transakcje.” |
| 2:10–2:30 | [Kliknij nazwę sprawy → **v2** → **Uruchom ponownie** → **Zmiany**, potem **Graf**] | „Analizy można powtarzać cyklicznie. Między przebiegami osoba podmieniła adres na profilu – narzędzie to wykrywa, a nowy adres dostaje premię za przelew ze starego. Graf pokazuje całą ścieżkę: identyfikator, źródło, adres, giełda.” |
| 2:30–2:45 | [**Raport (HTML / PDF)** → przewiń: legenda, adresy, Fakty/Obliczenia/Wnioski, Źródła z SHA-256] | „Raport rozróżnia fakty ze źródeł, wyniki obliczeń i wnioski do weryfikacji. Zawiera źródła z hashem, wersje narzędzi i pełny dziennik zapytań – analizę można odtworzyć.” |
| 2:45–3:00 | [README na GitHubie – sekcja Testy / slajd 10] | „Całość to open source, uruchamiana jednym poleceniem docker compose, bez chmury publicznej. Scenariusz testowy: 21 na 21. Krypto Radar.” |

## Wskazówki

- Nie czytaj adresów na głos – pokazuj je kursorem.
- Jeśli przebieg trwa dłużej niż 5 s, wytnij oczekiwanie w montażu.
- Po kliknięciu **v2** i nagraniu przełącz z powrotem na **v1**.
- Na filmie używaj tylko trybu demo, żeby nie pokazywać danych prawdziwych osób.

## Publikacja

- YouTube (publiczny lub niepubliczny link) albo plik MP4 w repozytorium GitHub (do 100 MB, np. w zakładce Releases).
- Link wklej do README w sekcji „Film” i do formularza zgłoszenia.
