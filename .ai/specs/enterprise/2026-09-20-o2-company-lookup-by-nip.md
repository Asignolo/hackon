# O2 — dane firmy po NIP z O1 (demo)

## 📝 TLDR

O2 dostaje NIP z istniejącego `nip[]` wyniku O1 i pobiera dane firmy przez `trev0n/ceidg-scraper`. Dodajemy jedno narzędzie do istniejącej integracji Apify i podłączamy je do O2. Bez abonamentu aktora, dodatkowego tokenu CEIDG, nowego UI, tabel ani zapisu do CRM.

## 📝 Overview / Problem Statement

O1 już zwraca kandydatów NIP z dowodami i confidence. `photographers.apify_link_researcher_o2` przyjmuje dziś tylko linki, a `integration_apify` udostępnia cztery narzędzia social/Maps. Brakuje odczytu danych rejestrowych po gotowym NIP. Demo ma pokazać ten odczyt w istniejącym Playground.

## 📝 Proposed Solution

Dodać `integration_apify.scrape_ceidg_company`, wywoływane maksymalnie raz przez O2. Korzystać z istniejącego executora Apify i tokenu Apify skonfigurowanego dla organizacji. Nie budować generycznego `run_actor`, wyszukiwania po nazwie, batcha ani nowego procesu.

Zweryfikowany bezpośrednio w przeglądarce 2026-09-20 [cennik](https://apify.com/trev0n/ceidg-scraper/pricing): $3/1000 wyników, start $0.00005 za zdarzenie (jedno na GB pamięci, minimum jedno), platform usage w cenie. Brak abonamentu aktora. Wcześniejsza informacja o $15/miesiąc pochodziła z nieaktualnej wersji strony i jest wycofana.

[Input aktora](https://apify.com/trev0n/ceidg-scraper/input-schema) obsługuje wyszukiwanie po NIP; [README](https://apify.com/trev0n/ceidg-scraper) deklaruje brak dodatkowego klucza rejestru. Alternatywa `d_northlist/pl-company-lookup` odpada dla tego demo: JDG wymaga tam dodatkowego tokenu CEIDG. Własny scraper lub bezpośrednia integracja rejestrowa zwiększa zakres bez korzyści dla tej funkcji.

## 📝 Architecture

- Provider: `packages/integration-apify/src/modules/integration_apify/ai-tools.ts`, `lib/actor-catalog.ts`, `lib/targets.ts`, `lib/result.ts`, nowy `lib/normalizers/ceidg-company.ts` i testy.
- Dodać klucz katalogu `ceidg_company`, target `{ nip: string }`, platformę `ceidg`; uzupełnić istniejące rozgałęzienia typów bez zmiany działania czterech obecnych narzędzi.
- Zastosować `defineAiTool`, `isMutation: false`, istniejące `integration_apify.research` i `executeApifyActor`. Zachować tenant/organization scope, kontrolę kosztu, timeout, brak ponawiania płatnych wywołań, cleanup i ograniczenie rozmiaru wyników. Brak zmian silnika agentów i health checka.
- Przypiąć zweryfikowany build, hash input schema, fingerprint ceny i fixture tak jak inne wpisy katalogu; nie wpisywać fikcyjnych wartości ani `latest`. To zadanie implementacyjne, niewymagające decyzji produktowej.
- Agent: `apps/mercato/src/modules/photographers/agents/apify_link_researcher_o2/{AGENT.md,OUTCOME.md,SAMPLE.json}` oraz jego test i README.

## 📝 Data Model

Bez encji i migracji. Dane pozostają w istniejącym research/AgentRun i jego chronionej ścieżce utrwalania. Normalizator zwraca wyłącznie `nip`, `companyName`, `regon`, `krs`, `businessStatus`, `registerDate`, `registry`; brak surowego datasetu, danych bankowych i dodatkowych danych osób. Token Apify pozostaje w istniejącym credentials service i nie trafia do promptów, wyników ani logów.

## 📝 API Contracts

Nowy tool przyjmuje `{ nip: string }`. Provider normalizuje opcjonalny prefiks PL, spacje i myślniki oraz sprawdza 10 cyfr i sumę kontrolną. Nie ufa wyłącznie `checksumValid` od O1. Niepoprawne wejście nie uruchamia aktora.

Input aktora, ustalony przez provider:

```json
{ "searchMode": "nip", "searchValues": ["<normalizedNip>"], "maxResults": 1, "sourceFilter": "ALL", "status": "ALL" }
```

`ALL` zachowuje możliwość znalezienia wpisu KRS oraz firmy zawieszonej; nie jest deklaracją odczytu pełnego KRS ani statusu VAT. Pozostałe ustawienia pochodzą ze zweryfikowanego pinned builda. Agent nie podaje Actor ID, proxy, limitu ani dowolnego JSON.

Output: istniejący `ApifyResearchResult<CeidgCompanyData>` z `platform: "ceidg"`, `actorRunId`, `observedAt`, diagnostyką i `data` opisanym wyżej. Pola opcjonalnie niedostępne mają `null` oraz wpis `unavailableFields`. `nip` wyniku musi zgadzać się z zapytaniem; rozbieżność oznacza błąd, bez zwracania profilu innej firmy. Pusty dataset oznacza `no_data`; wadliwa struktura odpowiedzi — błąd schematu, nie brak firmy. Nie wymyślać URL wpisu: provider może zwrócić `sourceUrl` i `canonicalUrl` jako `null`.

### Zachowanie O2

1. Zachować trzy obecne warianty wejścia (dane O1, research envelope, `{ o1: ... }`). Brak `nip` jest zgodny ze starym wejściem. Akceptować samo `nip[]` bez `links`; wejście z żadną poprawną tablicą pozostaje `invalid_input`.
2. Zdeduplikować poprawne NIP. Wybrać najwyższe confidence, przy remisie kolejność O1; pominąć konflikty, błędne i pozostałe kandydatury z krótkim powodem. Wymagać źródła od O1. Nie szukać zastępczego numeru.
3. Odczyt NIP wykonać pierwszy, następnie dotychczasowe odczyty social w ich kolejności, do istniejącego maksimum czterech płatnych wywołań łącznie. Przy pełnym zestawie celów pominąć ostatni odczyt opinii Maps z powodem limitu. Bez NIP zachowanie czterech obecnych wywołań nie zmienia się. Limity executora mogą zatrzymać serię wcześniej; nie podnosić ich globalnie.
4. Przepisać `confidence` i `approvalRequired` z O1 bez wzmacniania pewności. To research kandydata, nie przypisanie firmy do fotografa ani decyzja K1.
5. Dodać nowy tool do enum `results[].tool`; zachować `resultJson` jako pełny ograniczony wynik providera. Istniejące wymagane `results[].url` zawiera dla nowego toola URL dowodu NIP z O1, nie fikcyjny link CEIDG. Sam NIP jest w `resultJson.data.nip`; przy błędzie podać zapytany NIP w wyjaśnieniu. Brak nowych wymaganych pól OUTCOME.

## 📝 UI/UX

Istniejący Playground prezentuje research JSON i ślady wywołań. Podsumowanie i powody pominięcia po polsku. Brak nowych ekranów lub komponentów. Brak NIP nie blokuje social researchu; brak integracji, ACL, kontekstu runu lub budżetu obsługiwany jak obecnie.

## 📝 Risks & Impact Review

| Ryzyko | Waga | Obsługa i ryzyko pozostałe |
| --- | --- | --- |
| NIP należy do innej osoby/studia | Wysoka | Zachować dowody i niepewność O1; zero automatycznego zapisu do CRM. Rejestr nie potwierdza właściciela portfolio. |
| Timeout, blokada rejestru, zmiana schematu | Średnia | Istniejący timeout/abort/cleanup, jawny błąd, bez retry. Live demo nadal zależy od dostawcy. |
| Zmieniona cena albo build | Średnia | Zweryfikowany katalog i istniejący limit opłaty. Nie obchodzić odrzucenia przez executor. |
| Domyślny budżet kończy się przed social research | Niska | NIP jako pierwszy, dalsze wywołania zgodnie z budżetem; jawne skipped. Pełny komplet social nie jest kryterium tego demo. |
| Płatny start bez wyniku | Niska | Koszt startu uwzględnić w katalogu i smoke; zakończonego naliczenia nie można cofnąć. |

## 📝 Migration & Backward Compatibility

Zmiana addytywna: nowy tool, target i wariant platformy; stare ID, ACL, inputy i wyniki pozostają ważne. Rozszerzenie enum O2 nie usuwa starych wartości; historyczne research JSON nadal przechodzi walidację. Bez migracji i nowych zależności. Niniejszy spec rozszerza wcześniejsze wyłączenie CEIDG w `2026-09-19-apify-research-provider-agent-orchestrator.md` wyłącznie o odczyt po NIP.

Rollback: usunąć nowy tool z allowlist O2 i przywrócić poprzedni prompt; rejestrację toola pozostawić dla kompatybilności. Nie kasować historycznych wyników. Brak mutacji domenowych do odwrócenia; koszt uruchomienia Apify jest nieodwracalny.

## Final Compliance Report — 2026-09-20

Zakres: jedna zdolność O2 — odczyt danych rejestrowych po NIP. Wykorzystuje istniejący provider i deklaratywny tool, zachowuje ACL/scope oraz research-only zgodnie z root AGENTS i zasadami agent_orchestrator. Brak zmian UI, ORM, pipeline i silnika agentów. Kontrakt wejścia, normalizacja, błędy, limit i rollback opisane powyżej. Weryfikacja działania zewnętrznego aktora pozostaje częścią implementacji; ten dokument nie potwierdza wykonanego live testu.

## Changelog

Niezależny przegląd spójności zakresu: PASS — provider, podłączenie O2 i testy stanowią jedną funkcję; podział na osobne specy nie jest potrzebny.

- 2026-09-20: gotowy spec demo; NIP pochodzi z O1. Przywrócono pierwotnie wskazany `trev0n/ceidg-scraper` po bezpośredniej weryfikacji cennika; usunięto niepotrzebne pytanie o token CEIDG.

## 📋 Phasing / Implementation Plan

Jedna faza, trzy kroki; każdy zachowuje działanie istniejącej aplikacji.

1. **Provider:** potwierdzić build/input/output/cenę, dodać katalog, walidację, normalizer i tool. Testy unit: poprawny/niepoprawny NIP, zgodność NIP wyniku, brak wyniku, niepełne pola, zła struktura; test integracyjny tool → istniejący executor → atrapa Apify sprawdza input, scope/credentials, ACL, koszt, timeout i cleanup. Stare cztery narzędzia przechodzą regresję.
2. **O2:** allowlist, prompt, enum OUTCOME, sample i README. Test loadera oraz kontraktu dla starych wyników i CEIDG; scenariusze wejścia tylko z NIP, bez NIP, z duplikatami, z konfliktem oraz NIP + pełne social. Sprawdzić zachowanie confidence/approvalRequired i limit czterech wywołań. Uruchomić `yarn generate` po zmianach odkrywanych plików.
3. **Demo i gate:** wybrać runner Docker/local zgodnie z repo; uruchomić właściwe testy providera/O2 i typecheck/build dotkniętych pakietów. Integracyjne scenariusze istniejącego Playground: O1 → wywołanie toola → research z profilem oraz brak NIP → dotychczasowy research; bez nowych endpointów do pokrycia. Testy automatyczne używają samodzielnych fixture i mocka Apify, bez płatnych wywołań i zależności od seedów. Osobny, jawny live smoke jednego publicznego NIP JDG na koncie demo potwierdza odpowiedź, brak dodatkowego klucza i koszt; zapisać wynik bez sekretów. Gotowe, gdy O2 zwraca dane firmy zgodne z wejściowym NIP albo prawdziwe `no_data/error`, bez regresji starych wejść.
