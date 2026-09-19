# Opiekun nowego fotografa — Ukryty potencjał

`hidden-potential.v1.json` to wersjonowany dokument wejściowy istniejącego API
`POST /api/workflows/definitions`, z identyfikatorem `photographers.hidden_potential`.
Zawiera 24 kroki, 34 połączenia, nazwy, opisy wejścia/wyniku oraz pozycje w istniejącym
edytorze Automatyzacji. Krok O1 ma konfigurację wywołania istniejącego agenta;
cały proces nadal pozostaje nieaktywnym szkieletem.

## Dostępność i bezpieczeństwo

Definicja ma `enabled: false` i `definition.triggers: []`. Silnik odmawia startu
wyłączonej definicji także przy podaniu konkretnej wersji. Samo `lifecycle: draft`
nie stanowi takiej blokady; dokument nie polega na tym polu.

Jedynie O1 ma aktywność `INVOKE_AGENT`. Pozostałe kroki nadal są miejscami
przyszłego podłączenia, bez wykonywalnych działań i zadań.
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
| O1 | Podłączony `agent_examples.portfolio_reader_o1`: `originalPortfolio`, `registrationEmail`, `firstName`, `lastName` z kontekstu → wynik `research` pod `context.o1`. Przygotowanie wejścia z rejestracji i dalsze użycie wyniku pozostają niepodłączone. |
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
Nie zmieniamy tego kontraktu przez globalny `contextSchema` z danymi osobowymi.
Obecne podłączenie O1 oczekuje czterech jawnych wartości w kontekście testowym;
odczyt rejestracji przez wcześniejszy krok `prepare`, przekazanie tych wartości
oraz adapter wyniku do materiałów nadal wymagają implementacji przed włączeniem procesu.

Pliki O2 pojawiły się równolegle podczas tej pracy; pozostają własnością drugiego
dewelopera i nie zostały zmienione ani podłączone przez szkielet. Ich bieżący
kontrakt pochodzi z `../agents/trace_finder/AGENT.md` i `OUTCOME.md`.

### O1 i Apify

O1 jest plikowym agentem OpenCode pod identyfikatorem
`agent_examples.portfolio_reader_o1`. Jego `AGENT.md` i `OUTCOME.md` znajdują się
w module `agent_examples`. Odkrywa stronę, kontakt, Instagram, Facebook i Google
Maps oraz NIP i miasto, zachowując źródła i pewność przypisania. Nie aktualizuje
CRM, nie uruchamia Apify ani nie odpytuje rejestrów podatników.

Aktywność `INVOKE_AGENT` mapuje cztery pola o tych samych nazwach z głównego
kontekstu, a `outputMapping: { "o1": "data" }` zachowuje cały wynik research.
Wartość `data` jest ścieżką wyniku, nie wyrażeniem `{{...}}`.
`onResult: { "alwaysAsk": true }` spełnia wymagany kontrakt aktywności;
platforma pomija disposition dla wyniku `research`. Pola `approvalRequired`
pozostają wskazówkami dla dalszego procesu i **nie tworzą propozycji ani zadań
Caseload**. Niepewne pozycje nie stają się zatwierdzone przez samo ukończenie O1.
Sygnał `agent_orchestrator.proposal.ready` obsługuje także powrót research z
dedykowanego workera; jego nazwa nie oznacza, że O1 tworzy propozycję.

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
CRM ani uprawnień. Dokument JSON nie korzysta
z auto-discovery i nie wymaga generatora, migracji ani przebudowania aplikacji.

## Weryfikacja

Runner: local. Test `hidden-potential-skeleton.test.ts` sprawdza istniejący walidator
API, rzeczywistą odmowę silnika `DEFINITION_DISABLED` przed zapisem, rozdział
odrzucenia i świadomego zamknięcia, interpolację czterech wartości O1 oraz
mapowanie research do `context.o1` z zachowaniem źródeł i wymogu akceptacji.
Po podłączeniu O1: 5/5 testów przeszło.
W pierwotnej weryfikacji edytora potwierdzono 24 węzły i 34 połączenia oraz odczytano
`enabled: false`, `triggers: []`, wersję 1 i zero instancji.
Test startu przez działające API nie został wykonany: automatyczna kontrola
bezpieczeństwa odmówiła tej operacji z powodu ryzyka uruchomienia niekompletnego
procesu przy niesprawnej blokadzie. Nie jest raportowany jako zaliczony.

`POST /api/workflows/definitions/<UUID>/test-step` pozwala sprawdzić O1 w nadal
wyłączonej definicji: przesłać `stepId: "o1"`, `activityType: "INVOKE_AGENT"`,
rzeczywisty `config` odczytany z zapisanej definicji i syntetyczny `context`
z czterema polami wejścia. Endpoint wykonuje tylko interpolację i mock:
`simulated: true`, `invoked: false`, `kind: "would_invoke"`. Generyczne
`wouldRequestDisposition: "human_review"` tego mocka nie jest decyzją o research
O1. Endpoint nie uruchamia agenta; konfigurację badanego kroku trzeba przekazać w żądaniu.
Rzeczywiste O1 testuje się osobno istniejącym Sandbox/Playground, bez włączania
szkieletu i bez używania rzeczywistych danych rejestracyjnych.
