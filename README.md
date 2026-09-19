# hackon

Aplikacja oparta na kodzie monorepo [Open Mercato](https://github.com/open-mercato/open-mercato), pobranym z gałęzi `develop` 18 września 2026 r.

- Wersja źródeł: `0.8.0`.
- Commit upstream: `83330e271e0da0e0ae8ed4dd4d83369735cc06e6`.
- Aplikacja: `apps/mercato`.
- Pakiety frameworka: `packages/*`; aplikacja korzysta z `workspace:*`, zamiast gotowych pakietów npm 0.7.0.
- Historia i zdalne repozytorium projektu pozostają w `Asignolo/hackon`.

## Orkiestracja agentów

W `apps/mercato/src/modules.ts` domyślnie włączono:

```dotenv
OM_ENABLE_ENTERPRISE_MODULES=true
OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true
```

Aktywuje to `agent_orchestrator`, `agent_examples` oraz bazowe moduły enterprise: `record_locks` i `system_status_overlays`. SSO i security zachowują własne, domyślnie wyłączone przełączniki.

Zmienne środowiskowe mają pierwszeństwo przed domyślnymi wartościami kodu. Po skopiowaniu upstreamowego `apps/mercato/.env.example` ustaw obie powyższe wartości na `true`, ponieważ upstreamowy przykład ma je wyłączone.

## Instalacja i budowanie

Wymagane: Node.js 24 i Yarn 4.17.1 przez Corepack.

```bash
nvm use
corepack enable
yarn install --immutable
yarn build
```

Jeśli pracujesz z agentem programistycznym, zainstaluj instrukcje projektu poleceniem `yarn install-skills`. Jest to osobny, opcjonalny krok przygotowania środowiska.

`yarn build` buduje lokalne pakiety, generuje rejestry modułów, ponownie buduje pakiety z rejestrami i tworzy produkcyjną aplikację Next.js.

Lokalna konfiguracja aplikacji znajduje się w `apps/mercato/.env`; konfiguracja usług Docker pozostaje w głównym `.env`. Pliki te są ignorowane przez Git.

## Uruchomienie

```bash
docker compose up -d --wait postgres redis meilisearch
yarn start
```

Zachowano dotychczasowy `docker-compose.yml` i nazwy wolumenów. Dane usług nie są przenoszone ani resetowane podczas budowania.

Samo zbudowanie nie aktualizuje schematu istniejącej bazy 0.7.0 ani nie przygotowuje tabel nowo włączonych modułów. Przed użyciem aplikacji z tą bazą należy osobno sprawdzić i zastosować migracje. Wykonywanie agentów wymaga również konfiguracji dostawcy AI; agenci OpenCode wymagają usługi OpenCode.

## Wynik weryfikacji (2026-09-18)

`yarn install --immutable` oraz pełne `yarn build` zakończyły się kodem 0 pod Node.js 24.16.0 (lokalnie). Zbudowano 38 pakietów, rejestry zawierają `agent_orchestrator` i `agent_examples`, a aplikacja przeszła kontrolę TypeScript i build produkcyjny.

Naprawiono generator OpenAPI: importy JSON z pakietów są dołączane do jego kodu, zamiast trafiać do Node.js bez wymaganych atrybutów. Dokumentacja zawiera 637 ścieżek, 455 operacji ze schematami żądań i 1059 operacji ze schematami odpowiedzi. Wszystkie 11 testów generatora przechodzi, w tym test regresji sprawdzający schematy i ich odświeżanie po zmianie danych JSON. Ostrzeżenie o alternatywnej ścieżce manifestu agentów dotyczy wariantu standalone; monorepo ma właściwy manifest w pakiecie enterprise.

Istniejące pliki lokalne pozostają w głównym `storage/`; aplikacja korzysta z dowiązania `apps/mercato/storage -> ../../storage` (lokalnego, ignorowanego przez Git).

## Aktualizacja lokalnej bazy (2026-09-18)

Zastosowano wszystkie 43 oczekujące migracje do lokalnej bazy `hackon` i odświeżono indeksy słowników klientów, słowników ogólnych oraz definicji workflow. Kopia sprzed aktualizacji znajduje się w `.backups/2026-09-18-before-develop-migrations/before-migration.dump` (ignorowana przez Git). Aplikację uruchomiono ponownie na porcie 3001.


## Scenariusz demonstracyjny Fotografów

Po zbudowaniu aplikacji otwórz **Fotografowie → Scenariusz demonstracyjny** (`/backend/photographers/demo`).

1. Utwórz fikcyjnego fotografa przyciskiem uruchomienia. Ekran pokaże postęp oraz linki do osoby, szansy i procesu.
2. Gdy pojawi się decyzja, otwórz Caseload, przeczytaj materiały i zatwierdź albo odrzuć szkic.
3. Wróć do scenariusza i sprawdź wynik w CRM. Akceptacja zapisuje szkic i przenosi szansę do etapu Skontaktowana; odrzucenie kieruje ją do obserwacji.

Demo korzysta z przygotowanych fikcyjnych źródeł. Nie wymaga dostawcy LLM ani dostępu do zewnętrznych serwisów i nie wysyła wiadomości. Powrót do adresu tej samej sprawy odtwarza jej stan. Przycisk nowej demonstracji tworzy osobny przykład.

Scenariusz wymaga włączonych procesów, workflow i zadań w tle oraz instalacji konfiguracji modułu Fotografowie. Pełne badanie rzeczywistych rejestracji pozostaje kolejną częścią [specyfikacji](.ai/specs/enterprise/2026-09-19-photographer-hidden-potential-mvp.md).
