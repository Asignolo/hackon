# Walidacja integracji

Runner: local, Node 24.16.0. Aplikacja i PostgreSQL testów są izolowane od bazy użytkownika. Automatyczne workery zewnętrzne wyłączone; testy prowadzą odkryte workery przez kontrolowane odpowiedzi OpenCode.

## Bramka repozytorium

- `yarn build:packages`: PASS, 39 zadań, również pełny wymuszony build po generowaniu.
- `yarn generate`: PASS, enterprise i agents włączone. Rejestry generowane narzędziem, bez edycji ręcznej.
- `yarn typecheck`: PASS, 39 zadań. Dodatkowy typecheck aplikacji PASS.
- ESLint wszystkich plików TS/TSX czterech wycinków i integracji: PASS.
- `yarn i18n:check-usage`: PASS, 7918 istniejących ostrzeżeń advisory o nieużywanych kluczach.
- `yarn i18n:check-sync`: FAIL poza Photographers: integration_apify ma nieposortowane en/pl i po dwa brakujące klucze w es/de/ko. Photographers zsynchronizowany i posortowany.
- `yarn test`: FAIL poza Photographers przed wykonaniem pełnego zestawu: web-research-firecrawl/ts-jest nie obsługuje JavaScript API zainstalowanego TypeScript 7.0.2. Nie zmieniano zależności projektu.
- Build aplikacji w natywnym runnerze ephemeral: PASS po uzupełnieniu brakujących lokalnych zależności aplikacji. Początkowe problemy środowiska nie są pozostawionymi błędami Photographers.
- `git diff --check`: PASS.

## Testy modułu i całego przepływu

Photographers Jest: **51 zestawów / 601 testów PASS**. Obejmuje regresje materiałów, punktacji, źródeł niepotwierdzonych, powtórzeń, częściowych wyników, braków konfiguracji, błędów, uprawnień i podglądu.

**E2E: 6/6 PASS (37,6 s)** na końcowym kodzie:

- podgląd oczekującej oceny, brak mutacji i obsługa 403;
- pełna ocena + przeglądarka: zapisane 1250 obserwujących, kategoria Wedding, 5/100 punktów;
- rejestracja bez portfolio;
- częściowy wynik O2;
- błędny OUTCOME O2: FAILED, bez punktacji;
- wyłączone szyfrowanie workera O2: FAILED przed wywołaniem usługi, bez punktacji.

Każdy scenariusz bada ponowne dostarczenie oraz niezmienione liczniki wywołań/materiałów. Build aplikacji końcowego przebiegu: PASS (127 s). Zrzut zapisanej oceny: `.ai/qa/test-results/artifacts/apps-mercato-src-modules-p-74c89-e-saved-evaluation-complete/saved-assessment.png`; raport maszynowy `.ai/qa/test-results/results.json`.

Zweryfikowany commit implementacji: `682dfaae`. Końcowy przegląd sprawdził granice transakcji, powiązania właścicieli, idempotencję i brak pozornego sukcesu; znalezione błędy porównania śladów i sprawdzania konfiguracji zostały poprawione przed końcowym E2E.

Zakres testu całego procesu: API rejestracji używane przez formularz → rzeczywiste CRM → start procesu/workflow v3 → odkryte workery O1/O2 → rzeczywisty agentRuntime → zapis szyfrowanych materiałów → normalizacja zapisanego O2 → odczyt zapisanych faktów → istniejący kalkulator → GET assessment i podgląd przeglądarkowy.

Warianty: pełny wynik, brak portfolio, częściowy O2, zakończony błędny OUTCOME, wyłączona wymagana konfiguracja; powtórne dostarczenie bez dodatkowych wywołań ani materiałów. O1 zwraca niepotwierdzone źródło wymagające akceptacji, co sprawdza jawne założenie demo bez zmieniania oryginalnego wyniku.

W testach zastąpiony jest klient zewnętrznego OpenCode, dostarczający odpowiedzi modelu/OUTCOME z kontrolowanymi wynikami dostawcy. API, workflow, workery, runtime, magazyn i kalkulator nie są podstawione. Te testy nie wykonują rzeczywistych płatnych połączeń modelu/Apify i nie stanowią dowodu dostępu do internetu ani konfiguracji kont dostawców.

Pierwszy test błędu modelu symulował przerwanie transportu i uruchamiał oczekiwanie runtime na zakończenie sesji; końcowy test używa zakończonego błędnego OUTCOME. Pierwsza próba braku konfiguracji usuwała mapę szyfrowania, lecz framework stosował domyślne mapy; końcowy test wyłącza szyfrowanie w izolowanym procesie workera i przywraca je w finally.

## Ograniczenia

- Płatny test rzeczywistych usług nie był uzgodniony ani uruchomiony.
- Bramka całego monorepo nie jest zielona z powodu opisanych błędów testów i tłumaczeń poza zakresem.
- Test integracyjny wykorzystuje lokalną strategię kolejki; nie stanowi osobnego testu obciążenia kolejek Redis.
- Nie wdrożono zmian do głównego checkoutu ani istniejącej bazy. Stare aktywne demo v1/v2 i przesłonięcia definicji wymagają świadomej obsługi operatora.
- Niejednoznaczne przerwanie zewnętrznego wywołania wymaga ręcznego wyjaśnienia; automatyczne ponowienie płatnego wywołania jest celowo wykluczone.

Commit pomija hook przez `HUSKY=0`, ponieważ repo hook może poprawiać i stage’ować tłumaczenia innych modułów. Kontrole powyżej wykonano jawnie; nie zmieniano konfiguracji hooków.

Odtworzenie E2E: Node 24, lokalne losowe `JWT_SECRET`/`AUTH_SECRET`, flagi
`OM_ENABLE_ENTERPRISE_MODULES=true`, `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`,
`OM_INTEGRATION_MODULES=photographers`, `AUTO_SPAWN_WORKERS=false`,
`OM_EVENTS_EXTERNAL_WORKER=true`, następnie
`yarn test:integration:ephemeral --filter TC-PHOTOGRAPHERS-027 --no-screenshots --verbose`.
Końcowy przebieg używał też `--keep`; po weryfikacji zatrzymano wyłącznie jego
serwer i kontenery. Raport i screenshot pozostały na dysku. Końcowy kod 143 procesu
Next w logu oznacza celowe wyłączenie po zaliczeniu testów.
