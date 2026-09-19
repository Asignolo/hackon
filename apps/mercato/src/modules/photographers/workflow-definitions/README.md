# Opiekun nowego fotografa — Ukryty potencjał

`hidden-potential.v1.json` to wersjonowany dokument wejściowy istniejącego API
`POST /api/workflows/definitions`, z identyfikatorem `photographers.hidden_potential`.
Zawiera 24 kroki, 34 połączenia, nazwy, opisy wejścia/wyniku oraz pozycje w istniejącym
edytorze Automatyzacji. Jest szkieletem autorskim, nie implementacją procesu.

## Dostępność i bezpieczeństwo

Definicja ma `enabled: false` i `definition.triggers: []`. Silnik odmawia startu
wyłączonej definicji także przy podaniu konkretnej wersji. Samo `lifecycle: draft`
nie stanowi takiej blokady; dokument nie polega na tym polu.

Żaden krok nie ma działań, funkcji, agentów, zadań, danych przykładowych ani wyników.
Wyjścia z niewdrożonych kroków mają `trigger: manual`, aby nie przechodziły
samoczynnie. To techniczny stan niepodłączonego grafu, **nie dodatkowe decyzje
biznesowe człowieka**. Trzy wyjścia z `PARALLEL_FORK` mają `auto`, czego wymaga
walidator platformy. Fork i join wskazują na siebie. Całość pozostaje wyłączona.
Nazwy rozgałęzień opisują docelowe warunki, ale nie wykonują ich. Kroki opisujące
Caseload również są tylko miejscami podłączenia jego natywnego mechanizmu
propozycji, disposition i oczekiwania; nie tworzą równoległej kolejki zadań.

Nie włączać v1. Implementacja kolejnych etapów wymaga osobnych przyrostów,
podłączenia rzeczywistych kontraktów i testów przed opublikowaniem wersji wykonawczej.

## Kontrakty i miejsca podłączenia

Dokładny opis każdego kroku znajduje się w jego `description` i jest dostępny
w inspektorze edytora. Dokument nie deklaruje nowego modelu danych.

| Kroki | Istniejący kontrakt / przyszłe podłączenie |
| --- | --- |
| Wejście, przygotowanie | `photographers.registration.prepare_crm`, wejście `{ registrationId }`, wynik `RegistrationCrmResult` ze stanem `ready` i `photographerId`, `personId`, `dealId`. Rejestracja pozostaje niezmieniona; ponowienie wykorzystuje istniejącą osobę i szansę. |
| O1 | Spec MVP wskazuje `photographers.portfolio_reader`: dane rejestracji i portfolio → odczyt i ślady. To docelowa deklaracja, nie potwierdzona implementacja. |
| O2 | Dostępny przyrost `photographers.trace_finder`: `registrationId`, `firstName`, `lastName`, `email`, opcjonalne `portfolioRaw` → research `status`, `candidates` (`url`, `kind`, `name`, `evidence`, `sourceUrl`), `summary`, `issues`. Nie wymaga O1. Adapter do `tracesSnapshotSchema` i rozszerzenie o wynik O1 pozostają niepodłączone. |
| Przypisanie, decyzja, dopuszczone ślady | `traceEvidenceSchema`, `tracesSnapshotSchema` i natywne propozycje Caseload. Odrzucony ślad nie trafia do badania; pozostałe potwierdzone mogą trafić. Brak konkretnej propozycji nie tworzy pustego zadania. |
| A2 | `researchFactSchema`, `owner: social`; docelowo `photographers.social_researcher`. |
| A3 | `researchFactSchema`, `owner: portfolio`; docelowo `photographers.portfolio_researcher`. |
| R1 | Potwierdzone identyfikatory → `researchFactSchema`, `owner: registry`; przyszła funkcja workflow czyta rejestry, bez ponownego ustalania tożsamości. |
| Scalenie, walidacja | Trzy niezależne wyniki → `factsSnapshotSchema`, odwołanie do śladów, braki i sprzeczności. |
| Punktacja | `factsRef`, `evaluatedAt`, `rulesVersion` → `scoreSnapshotSchema`; reguły pozostają niewdrożone. |
| Dalsze postępowanie, decyzja | Propozycja i pełna polityka platformy → obserwacja, kwalifikacja, jawne zamknięcie lub odrzucenie bez akcji. Kontakt mimo flagi wymaga uzasadnienia i `waiverSnapshotSchema`. |
| Obserwacja | Zatwierdzona obserwacja albo brak użytecznych śladów → przyszły zapis historii i terminu; bez harmonogramu. |
| A4 | Zatwierdzona kwalifikacja i dozwolone dowody → `messageSnapshotSchema`; docelowo `photographers.message_writer` i propozycja z `alwaysAsk: true`. |
| Decyzja o wiadomości, zapis / brak kontaktu | Każda treść wymaga człowieka. Zatwierdzenie lub poprawa → zapis zatwierdzonej rewizji; odrzucenie → docelowo powrót z „Do kontaktu” do obserwacji z adnotacją o decyzji, bez zamknięcia szansy. Bez wysyłki; skutki pozostają niepodłączone. |
| Jawne zamknięcie | Wybrana opcja `close_lost` z powodem → przyszła komenda CRM. Sama flaga ani odrzucenie propozycji nie zamykają szansy. |
| Historia i zakończenie | Odwołania do materiałów, runów i decyzji → `evaluationSummarySchema`. Zakończenie oceny nie oznacza wysłania wiadomości ani zamknięcia szansy. |

Schematy materiałów pochodzą z `../data/evaluation-validators.ts`; kontrakt CRM z
`../data/registration-crm-validators.ts` i `../lib/registration-crm.ts`. Historyczne
`eligibility_required` w schemacie kompatybilności nie jest warunkiem tego procesu.
Brak zamówień jest założeniem wejściowym. Specyfikacja przewiduje identyfikatory
`registrationId`, `photographerId`, `dealId`, `evaluationId`, `source`, `evaluatedAt`
i `rulesVersion`; dane osobowe mają być odczytywane dopiero przez potrzebujący ich
krok, a kontekst workflow ma przenosić bezpieczne odwołania do materiałów.

Pliki O2 pojawiły się równolegle podczas tej pracy; pozostają własnością drugiego
dewelopera i nie zostały zmienione ani podłączone przez szkielet. Ich bieżący
kontrakt pochodzi z `../agents/trace_finder/AGENT.md` i `OUTCOME.md`.

### O1 i Apify — ustalenia dostępne 2026-09-19

W checkout `1b1fb61c` ani w rejestrze agentów uruchomionej aplikacji nie znaleziono
implementacji `photographers.portfolio_reader` ani `agent_examples.portfolio_reader_o1`.
Specyfikacja Apify opisuje drugi identyfikator jako czytnik wskazanego URL portfolio
z ogólnymi narzędziami WWW, lecz nie podaje kompletnego schematu jego wejścia/wyniku
ani kontraktu własnego workflow. Nie da się na tej podstawie potwierdzić, czy O1
obejmuje własny workflow. Nie utożsamiamy tych identyfikatorów i nie dodajemy
`INVOKE_AGENT` ani `SUB_WORKFLOW` ze zgadywanym kontraktem. Właściciel O1 musi
udostępnić identyfikator, wejście, OUTCOME i ewentualny workflow przed podłączeniem.

Apify dostarczy narzędzia odczytu konkretnych profili Instagram, stron Facebook
oraz miejsc/opinii Google Maps. Nie prowadzi procesu, nie wyszukuje fotografów
po e-mailu, nie obsługuje rejestrów i w obecnym zakresie nie dostarcza postów ani
engagement. Te braki nie mogą zostać zastąpione fikcyjnymi wynikami.

## Zapis w istniejącej aplikacji

1. W docelowej organizacji sprawdzić `GET /api/workflows/definitions?workflowId=photographers.hidden_potential`.
2. Wyłącznie gdy definicja nie istnieje, zapisać dokument przez `POST /api/workflows/definitions` w uwierzytelnionym kontekście operatora. Nie nadpisywać istniejącej definicji ani przejętej przez operatora wersji. Dalsze wersje tworzyć istniejącym mechanizmem wersjonowania, po osobnym uzgodnieniu zakresu implementacji.
3. Sprawdzić `enabled: false`, pustą listę wyzwalaczy i otworzyć `/backend/definitions/visual-editor?id=<zwrócony UUID>`.

Definicja jest dostępna na liście Automatyzacji bez `ProcessDefinition`.
Dlatego nie dodajemy teraz definicji procesu, jej wyzwalaczy ani połączenia
z odbiorcą zdarzenia rejestracji. Nie zmieniamy `workflows.ts`, demo, konfiguracji
CRM, istniejących definicji, uprawnień ani danych. Dokument JSON nie korzysta
z auto-discovery i nie wymaga generatora, migracji ani przebudowania aplikacji.

## Weryfikacja

Runner: local. Test `hidden-potential-skeleton.test.ts` sprawdza istniejący walidator
API, rzeczywistą odmowę silnika `DEFINITION_DISABLED` przed zapisem oraz rozdział
odrzucenia i świadomego zamknięcia. 3/3 testy i typecheck aplikacji przeszły.
W działającym edytorze potwierdzono 24 węzły i 34 połączenia oraz odczytano
`enabled: false`, `triggers: []`, wersję 1 i zero instancji.
Test startu przez działające API nie został wykonany: automatyczna kontrola
bezpieczeństwa odmówiła tej operacji z powodu ryzyka uruchomienia niekompletnego
procesu przy niesprawnej blokadzie. Nie jest raportowany jako zaliczony.
