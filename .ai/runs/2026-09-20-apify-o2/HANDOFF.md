# Apify O2 — przekazanie integracji

## Zakres

Adapter istniejącego `photographers.apify_link_researcher_o2`, bez zmian OUTCOME,
workflow głównego, o1, formularza, tożsamości i punktacji. Agent uruchamia się przez
DI `agentRuntime.run`, poza transakcją workflow, w kolejce modułu.
Historyczne `photographers.o2.store_result` pozostaje adapterem trace_finder.

## Wejście i podłączenie

Zarejestrowana funkcja workflow: `photographers.apify_o2.dispatch`.
Dokładne argumenty:

```json
{"o1RunId":"<UUID AgentRun o1>","tracesRef":"<UUID zapisanego materiału o1>"}
```

To pola `runId` i `tracesRef` zwrócone przez istniejące
`photographers.o1.store_result`. UUID muszą wskazywać wynik o1 tej samej instancji
workflow, tej samej organizacji i oceny. Adapter weryfikuje deterministyczny ID
materiału i jego zawartość wobec oryginalnego wyniku o1. Nie odtwarza wejścia o2 ze
spłaszczonych śladów: podaje agentowi `{o1: o1Run.output.data}` bez strat źródeł,
confidence i approvalRequired.

Kontekst instancji `photographers.hidden_potential` musi zawierać istniejący
`o1Preparation.result` (`registrationId`, `evaluationId`, `evaluatedAt`,
`photographerId`, `personId`, `dealId`, `userId`) albo te pola bezpośrednio.
`metadata.initiatedBy` i użytkownik wywołania muszą być zgodne.

Integrujący agent dodaje do przejścia prowadzącego do kroku `apify_o2`:

```json
{
  "activityId": "dispatch_apify_o2",
  "activityName": "apifyDispatch",
  "activityType": "EXECUTE_FUNCTION",
  "async": false,
  "config": {
    "functionName": "photographers.apify_o2.dispatch",
    "args": {
      "o1RunId": "{{context.o1Result.result.runId}}",
      "tracesRef": "{{context.o1Result.result.tracesRef}}"
    }
  }
}
```

Docelowy krok ma `stepId: "apify_o2"`, `stepType: "WAIT_FOR_SIGNAL"`,
`signalConfig: {"signalName":"photographers.apify_o2.ready"}`. Nazwa pola
`o1Result` w przykładzie odpowiada istniejącemu `activityName` zapisu o1.
Dispatch zwraca `{workflowInstanceId, signalName}`. Nie uruchamia płatnych odczytów
w transakcji przejścia. Worker wykonuje i kończy o2, zapisuje materiały i wysyła:

```json
{
  "apifyResearchRef": "<UUID końcowego materiału>",
  "apifyRunId": "<UUID AgentRun albo null, jeśli runtime nie wystartował>",
  "apifyResearchStatus": "complete|partial|no_data|no_targets|invalid_input|error"
}
```

Silnik sygnałów wznawia workflow. Nie dodano komendy klasyfikacji ani punktacji.

## Trwały wynik i odczyt przez etap 3 / podgląd

```ts
import { readApifyResearchResult } from './lib/apify-research-material'
const result = await readApifyResearchResult(apifyResearchRef, commandContext)
const outcome = result.payload?.outcome
const toolResults = outcome?.data.results
```

`commandContext` jest standardowym `CommandRuntimeContext` z uwierzytelnionym
użytkownikiem, tenantem i organizacją. Odczyt sprawdza ACL, powiązanie CRM,
szyfrowanie i integralność każdej części. Wynik:

- metadane materiału: `id`, `evaluationId`, `photographerId`, `personId`,
  `registrationId`, `dealId`, `schemaVersion`, `updatedAt`, `kind: apify_research`;
- `data`: identyfikatory o1/workflow/wywołania, `state`, `runId`, `runStatus`,
  `outcomeStatus`, `payloadRefs`;
- `payload.outcome`: dokładny obecny `{kind:"research",data:<OUTCOME>}` albo null,
  gdy runtime nie dostarczył poprawnego OUTCOME;
- `payload.rawOutput`: oryginalne wyjście runtime, także gdy nie spełnia schematu;
- `payload.o1`: pełny oryginalny wynik o1 (w tym źródła linków);
- `payload.toolCalls`: ID, nazwy, statusy, czas zapisu śladu, summaries, klucze
  artefaktów i błędy istniejących śladów narzędzi;
- `payload.error`: błąd runtime lub bezpieczny kod opisowy błędu przed utworzeniem run.

Czas faktycznego odczytu dostawcy jest w `outcome.data.results[].observedAt` i
wewnątrz `resultJson`; `toolCalls[].observedAt` oznacza czas utworzenia śladu, nie
czas odczytu dostawcy. Summaries śladów mogą być ograniczone przez runtime;
`responseArtifactKey` pozostaje odwołaniem do pełnego artefaktu, jeśli go wydzielono.
Nie przedstawiamy śladów jako pełnego OUTCOME po awarii agenta.

Każde `resultJson` pozostaje niezmienionym stringiem. Null, zero, diagnostics,
unavailableFields, statusy częściowe i skipped nie są normalizowane ani obcinane.
`not_configured` / `budget_exceeded` pozostają diagnostykami dostawcy wewnątrz
resultJson, a nie nowymi statusami OUTCOME. Etap 3 musi obsłużyć null outcome oraz
statusy błędów, bez zamieniania braków na zero.

Istniejący `GET /api/photographers/evaluation-materials/<researchRef>` zwraca
manifest. Klient HTTP odczytuje kolejno `data.payloadRefs` przez ten sam endpoint,
łączy `part.data.content` i parsuje JSON. Helper serwerowy robi to automatycznie.
Nie dodano nowego API ani migracji: nowe rodzaje materiałów mieszczą się w istniejącej
tabeli z tekstowym `kind`. Pojedyncze części mają maksymalnie 16000 jednostek UTF-16,
pozostając poniżej istniejącego limitu 128 KiB po escapowaniu. Cały wynik nie jest
obcinany. Manifest końcowy powstaje po wszystkich częściach. Identyfikatory części zależą
od skrótu całej treści: późno dopisane ślady narzędzi nie blokują ponowienia po
częściowym zapisie. Niedokończone starsze części mogą pozostać bez manifestu;
odczyt korzysta wyłącznie z części wskazanych przez końcowy manifest.

## Powtórzenia, awarie i odzyskiwanie

Klucz blokady zawiera tenant, organizację i tracesRef. Przed runtime powstaje
niezmienny materiał `state: claimed`, zapisany osobną komendą. invocationId jest
stabilny dla tego tracesRef; runtime dodatkowo stosuje swój unikalny klucz wywołania.

- Powtórzenie po sukcesie: ten sam końcowy researchRef, bez agentRuntime.run.
- Awaria zapisu po ukończeniu agenta: odczyt już zapisanego AgentRun i dokończenie
  materiałów; bez ponownych płatnych wywołań.
- Błąd agenta z zakończonym run: wynik błędny + zachowane wyjście/ślady, sygnał error.
- Błąd przed utworzeniem run: końcowy materiał error, bez automatycznego restartu.
- Niejednoznaczna awaria między claim a run lub nadal running: worker odmawia
  nowego uruchomienia i zgłasza pending. Kolejne dostarczenie może odczytać
  późniejsze zakończenie tego samego run. Po wyczerpaniu ponowień kolejki operator
  ponownie dostarcza ten sam job do `processApifyResearchJob`, nie usuwa claim.
  Brak run po awarii wymaga ręcznego rozstrzygnięcia; celowo nie ma automatycznej
  gwarancji postępu kosztem ponownego naliczenia opłat.
- Awaria sygnału po zapisie: ponowienie dostarcza zapisany researchRef.

Nie ma gwarancji odzyskania danych, których proces agenta nie zdążył trwale zapisać.
Nie wywołujemy dostawcy ponownie w celu odtworzenia takich danych.

## Rejestracja i konfiguracja

- `di.ts`: nowa funkcja `workflowFunction:photographers.apify_o2.dispatch`.
- `workers/apify-research.ts`: kolejka `photographers-apify-research`, concurrency 1;
  `yarn generate` i standardowy worker kolejek aplikacji muszą być uruchomione.
- Włączone photographers, workflows, agent_orchestrator, agent_examples i
  integration_apify; flagi `OM_ENABLE_ENTERPRISE_MODULES=true`,
  `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`.
- Działający istniejący runtime agenta/OpenCode i dostawca modelu; Apify
  skonfigurowany przez własny moduł: credentials, enabled, health, limiter.
- Szyfrowanie pól materiałów, AgentRun input/output oraz summaries narzędzi.
- ACL: photographers.evaluations.{run,view,manage}, customers.people.view,
  customers.deals.view, customers.interactions.{view,manage},
  agent_orchestrator.agents.run, agent_orchestrator.trace.view,
  integration_apify.research (wildcardy obsługuje istniejący RbacService).
- Budżety są konfiguracją integration_apify, nie są podnoszone przez adapter.
  Domyślne $0.25 rezerwacji na wywołanie / $0.50 na run mogą dać częściowy wynik
  przed czterema narzędziami. Żadne klucze dostawców nie trafiają do workflow.

## Pliki współdzielone do uważnego scalenia

`apps/mercato/src/modules/photographers/di.ts`,
`data/evaluation-validators.ts`, `data/material-validators.ts`,
`__tests__/material-store.test.ts`. Pozostałe pliki są nowe i mają prefiks
`apify-research`. Generator nie wymaga zmian śledzonych definicji agentów.
Po scaleniu uruchomić generate z właściwymi flagami enterprise.

## Weryfikacja

Runner: local (brak działającego kontenera app w sprawdzonych plikach compose).
Kontrolowane odpowiedzi dostawcy są składane w niezmieniony OUTCOME; runtime w
teście jest zastąpiony kontrolowanym wywołaniem zapisującym AgentRun. Testy używają
rzeczywistych walidatorów i kodeka materiałów oraz odrębnie storeEvaluationMaterial
z kontrolowanym ORM i szyfrowaniem. Nie wykonują połączeń Apify ani wywołań LLM.
Wyniki końcowe testów i ograniczenia kompilacji podano w odpowiedzi przekazującej.

Agent integrujący: scalić zmiany, podłączyć przejście i WAIT_FOR_SIGNAL, przekazać
apifyResearchRef etapowi faktów/podglądu, uruchomić całość w skonfigurowanym środowisku.

### Wynik walidacji (2026-09-20)

- `yarn generate`: PASS; moduły enterprise włączone w lokalnym nieśledzonym .env;
  nowy worker obecny w wygenerowanej rejestracji. Brak zmian śledzonych artefaktów
  generatora po ustawieniu właściwych flag.
- `node node_modules/jest/bin/jest.js --config apps/mercato/jest.config.cjs --runInBand --testPathPatterns '/photographers/__tests__/'`:
  **43 zestawy, 455 testów PASS**, w tym 21 testów nowych adaptera/odczytu i 2 nowe
  testy szyfrowanego magazynu. Kontrolowane ORM/runtime, bez prawdziwego Apify/LLM.
- `git diff --check`: PASS.
- Kontrola typów aplikacji (`node scripts/typecheck.mjs --incremental false` z apps/mercato):
  FAIL, 12 błędów TS2694/TS2339 w niezmienionym
  `src/modules/example/__integration__/TC-EXAMPLE-016-generator-plugin.spec.ts`
  dotyczących API pakietu TypeScript. Bez błędów w Photographers.
- `yarn build:app`: FAIL, Turbopack odrzuca symlink node_modules poza root worktree.
  Próba bezpośredniego `next build --webpack`: FAIL — brakujące
  `@valkey/valkey-glide`, alias wygenerowanych file-agents oraz moduły Node
  (`fs`, `tls`, `net`) w istniejącym łańcuchu pakietów klienckich.
  Pełny gate repozytorium nie jest zaliczony.
- Nie uruchomiono live E2E/DB ani płatnych odczytów. Agent integrujący powinien
  uruchomić złożony workflow w poprawnie zainstalowanym środowisku.

### Pełna lista plików zmiany

Ścieżki od `apps/mercato/src/modules/photographers/`:

- `data/apify-research-validators.ts` — nowy kontrakt magazynu; lustrzana walidacja OUTCOME.
- `data/evaluation-validators.ts` — dwa addytywne rodzaje materiałów.
- `data/material-validators.ts` — odpowiedzi istniejącego GET dla tych rodzajów.
- `lib/apify-research-runtime.ts` — dispatch, kolejka, wywołanie, rezerwacja, zapis i sygnał.
- `lib/apify-research-material.ts` — autoryzowany odczyt pełnego wyniku.
- `workers/apify-research.ts` — standardowy worker z własnym kontenerem żądania.
- `di.ts` — rejestracja funkcji workflow.
- `__tests__/apify-research-runtime.test.ts` — 13 testów wykonania i ponowień.
- `__tests__/apify-research-material.test.ts` — 8 testów odczytu/powiązań.
- `__tests__/material-store.test.ts` — 2 dodatkowe przypadki nowych rodzajów.

Ponadto ten dokument i
`.ai/specs/enterprise/2026-09-20-photographers-apify-o2-adapter.md`.
