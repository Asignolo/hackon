# Opiekun nowego fotografa — Ukryty potencjał

`hidden-potential.v1.json` to wersjonowany dokument wejściowy istniejącego API
`POST /api/workflows/definitions`, z identyfikatorem `photographers.hidden_potential`.
Zawiera 23 kroki, 33 połączenia, nazwy, opisy wejścia/wyniku oraz pozycje w istniejącym
edytorze Automatyzacji. Podłączony wycinek obejmuje przygotowanie rejestracji, wykonanie O1 w workerze
i zapis śladów. Podłączony jest również krok punktacji opisany poniżej. Cały proces nadal pozostaje nieaktywnym szkieletem.

## Dostępność i bezpieczeństwo

Definicja ma `enabled: false` i `definition.triggers: []`. Silnik odmawia startu
wyłączonej definicji także przy podaniu konkretnej wersji. Samo `lifecycle: draft`
nie stanowi takiej blokady; dokument nie polega na tym polu.

Przejście start → prepare wywołuje `photographers.o1.prepare`, które przygotowuje
CRM i zwraca tylko identyfikatory. Przejście prepare → o1 zleca pracę kolejce
`photographers-portfolio-discovery`. Krok O1 czeka na sygnał `photographers.o1.ready`.
Worker odczytuje oryginalne cztery pola rejestracji dopiero przed wywołaniem
`agentRuntime.run`. Sygnał przekazuje `o1RunId`; przejście do identity wywołuje
`photographers.o1.store_result`, zapisując materiał przed K1.

Pozostałe kroki czekają na implementację. Ich wyjścia mają `trigger: manual`,
co jest techniczną blokadą niepodłączonego grafu, nie dodatkową decyzją biznesową.
Trzy wyjścia z `PARALLEL_FORK` mają `auto`, czego wymaga walidator platformy.
Fork i join wskazują na siebie. Nazwy pozostałych rozgałęzień opisują docelowe
warunki, ale ich nie wykonują. Caseload nadal wymaga podłączenia natywnych
propozycji, disposition i oczekiwania.

Nie włączać v1. Implementacja kolejnych etapów wymaga osobnych przyrostów,
podłączenia rzeczywistych kontraktów i testów przed opublikowaniem wersji wykonawczej.

## Kontrakty i miejsca podłączenia

Dokładny opis każdego kroku znajduje się w jego `description` i jest dostępny
w inspektorze edytora. Dokument nie deklaruje nowego modelu danych.

| Kroki | Istniejący kontrakt / przyszłe podłączenie |
| --- | --- |
| Wejście, przygotowanie | `photographers.registration.prepare_crm`, wejście `{ registrationId }`, wynik `RegistrationCrmResult` ze stanem `ready` i `photographerId`, `personId`, `dealId`. Rejestracja pozostaje niezmieniona; ponowienie wykorzystuje istniejącą osobę i szansę. |
| O1 | Podłączony `agent_examples.portfolio_reader_o1`: oryginalne cztery pola odczytane z rejestracji → utrwalony `AgentRun` → `o1RunId` → adapter `photographers.o1.store_result`. Wynik `o1Result.result` zawiera tylko `runId`, `tracesRef` i status. |
| Przypisanie, decyzja, dopuszczone ślady | `traceEvidenceSchema`, `tracesSnapshotSchema` i natywne propozycje Caseload. Odrzucony ślad nie trafia do badania; pozostałe potwierdzone mogą trafić. Brak konkretnej propozycji nie tworzy pustego zadania. |
| A2 | `researchFactSchema`, `owner: social`; docelowo `photographers.social_researcher`. |
| A3 | `researchFactSchema`, `owner: portfolio`; docelowo `photographers.portfolio_researcher`. |
| R1 | Potwierdzone identyfikatory → `researchFactSchema`, `owner: registry`; przyszła funkcja workflow czyta rejestry, bez ponownego ustalania tożsamości. |
| Scalenie, walidacja | Trzy niezależne wyniki → `factsSnapshotSchema`, odwołanie do śladów, braki i sprzeczności. |
| Punktacja | `factsRef`, `evaluatedAt`, `rulesVersion`, `rulesSnapshot` → `photographers.evaluation.score` → szyfrowany `scoreSnapshotSchema`. Wynik `scoreResult.result` zawiera `scoreRef`, `factsRef`, `rulesVersion`; bez wykonania sugerowanej decyzji. |
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
Wejście wycinka: `registrationId`, `evaluationId`, `evaluatedAt` i zaufana tożsamość
wykonawcza. `o1Preparation.result` zawiera powiązania CRM i identyfikator wykonawcy.
Oryginalny e-mail, portfolio, imię i nazwisko nie są kopiowane do kontekstu workflow.

### O1 — kontrakt adaptera wyjścia

Jedynym agentem odkrycia jest `agent_examples.portfolio_reader_o1`, krok `o1`.
Odczytuje portfolio i wyszukuje pełny e-mail także przy braku portfolio.
Wejście obejmuje `originalPortfolio`, `registrationEmail`, `firstName`, `lastName`.
Nie ma osobnego kroku ani uruchamialnej definicji agenta O2.

Przejście `o1_identity_2` wywołuje `photographers.o1.store_result` z `o1RunId`.
Adapter czyta ukończony `AgentRun` ze zgodnym agentem, workflow, krokiem i próbą.
Sprawdza uprawnienia, organizację i zgodność wejścia z oryginalną rejestracją;
nie przyjmuje wyniku modelu od klienta. Ponowienie zapisu tego samego runu jest
idempotentne. Pierwszy przyrost nadal odmawia zapisu po natywnym rerun kroku.

Linki, NIP i miasto trafiają do materiału śladów wraz ze źródłami. Wszystkie
pozostają `unconfirmed` do K1, niezależnie od oceny `confidence` modelu.
Kontakt jest zapisywany jako ślad typu `website`. K1 odczytuje oryginalne portfolio
z rejestracji, a jego rozpoznanie z utrwalonego runu O1. Sam `resolvedUrl` bez
źródła nie tworzy nowego śladu. Pochodzenie fragmentu, ocena modelu i wynik
kontroli NIP pozostają w opisie dowodu, aby K1 nie utracił informacji o ograniczeniach. Wynik adaptera zawiera wyłącznie
`runId`, `tracesRef` i `status`; pełne badanie pozostaje przy runie i w materiale.
Niepełne odczyty, awarie i wyczerpany budżet nie oznaczają wyczerpania poszukiwań.
Historyczny wynik `no_portfolio` również nie uprawnia do zakończenia odkrycia.

Ślady są niezmiennym materiałem `kind: traces` w tabeli
`photographers_evaluation_materials`. Kolumna `body` jest szyfrowana; rekord
przechowuje zakres organizacji, identyfikator oceny i powiązania z rejestracją,
osobą i szansą. `tracesRef` to identyfikator tego rekordu. Uprawniony odczyt przez
`GET /api/photographers/evaluation-materials/:id` odszyfrowuje materiał i sprawdza
jego integralność. Nie powstaje nowy ekran śladów ani potwierdzone pola profilu.

Worker używa trwałego powiązania runu z workflow, krokiem `o1` i konkretnym
`StepInstance`. Ponowny odbiór ukończonego runu nie uruchamia modelu ponownie.
Ponowne dostarczenie po zakończeniu wycinka nie duplikuje materiału.
Natywny rerun tworzący drugą próbę pozostaje odrzucany. Run przerwany twardym
zatrzymaniem procesu, bez `completedAt`, wymaga osobnego odzyskania; ten przyrost
nie odtwarza zdalnej sesji ani nie uruchamia jej ponownie w ciemno.

Stary adapter O2 pozostaje wyłącznie mostem kompatybilności dla historycznych
wyników. Nowy graf go nie wywołuje, a usunięta definicja agenta nie podlega odkrywaniu.
Nie nadpisywać zapisanych wersji workflow ani historii wykonań w bazie.

### O1 i Apify

O1 jest plikowym agentem OpenCode pod identyfikatorem
`agent_examples.portfolio_reader_o1`. Jego `AGENT.md` i `OUTCOME.md` znajdują się
w module `agent_examples`. Odkrywa stronę, kontakt, Instagram, Facebook i Google
Maps oraz NIP i miasto, zachowując źródła i pewność przypisania. Nie aktualizuje
CRM, nie uruchamia Apify ani nie odpytuje rejestrów podatników.

Dotychczasowe testowe mapowanie całego `data` do `context.o1` zostało usunięte.
Worker wywołuje istniejący runtime, który zapisuje rzeczywisty run, a wynik
pozostaje w warstwie Orchestratora i szyfrowanym materiale. Przed uruchomieniem
worker sprawdza szyfrowanie wejścia/wyniku runu, zapisów narzędzi i materiału.
O1 zwraca `research`; nie tworzy propozycji ani decyzji Caseload.

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

Test grafu sprawdza walidator platformy, odmowę uruchomienia wyłączonej definicji,
połączenie przygotowania, zlecenia, oczekiwania i zapisu oraz brak mapowania PII.
Testy runtime obejmują zakres, uprawnienia, szyfrowanie i ponowienie wyniku.

TC-PHOTOGRAPHERS-024 sprawdza w odizolowanym środowisku rejestrację z portfolio
i rejestrację „brak”. Używa rzeczywistego API, CRM, silnika, kolejki, workera,
runtime agenta i magazynu. Wyłącznie klient zewnętrznego OpenCode zwraca kontrolowany
wynik. Testowa definicja jest wyprowadzona z pierwszych kroków tego grafu i kończy
się przed K1; pełna definicja pozostaje wyłączona.

Bieżące wyniki: [plan połączenia O1](../../../../../../.ai/runs/2026-09-19-photographer-o1-connection.md).
Historyczna walidacja konsolidacji O1/O2: 303 testy fotografów, 67 testów O1,
generowanie, kontrola typów, lint adaptera i build aplikacji przeszły. Nie stanowi
to dowodu wykonania obecnego wycinka ani jakości wyszukiwania w sieci.

## Krok punktacji — uzgodniona partia

Krok `score` oblicza 15 reguł bez modelu językowego. Przejście
`score_disposition_18` wykonuje `photographers.evaluation.score` i przekazuje
`scoreResult.result` do następnego kroku. `disposition` pozostaje niewdrożony;
nie powstaje propozycja, kontakt, zmiana etapu CRM ani wysyłka.

Warunki wejścia przygotowywane przez wcześniejsze kroki:

- Kontekst oceny: `registrationId`, `photographerId`, `personId`, `dealId`,
  `evaluationId`, `evaluatedAt` (także istniejący wariant `o1Preparation.result`).
- `factsRef`: identyfikator utrwalonego `factsSnapshotSchema`.
- `rulesVersion` i `rulesSnapshot`: niezmienna konfiguracja
  `hiddenPotentialRulesSchema` pobrana przy rozpoczęciu oceny. Krok nie czyta
  bieżących ustawień w zastępstwie brakującej wersji. Konfiguracja nie zawiera PII.
- Fakty i ich `tracesRef` muszą wskazywać materiały tej samej oceny,
  rejestracji, osoby i szansy w tej samej organizacji. Każdy znany fakt musi
  wskazywać potwierdzony ślad; fakty rejestrowe wymagają śladu typu `registry`.

Brakujące/nieznane fakty dają zero punktów i pozostają jawne w wyniku.
Flaga wymusza sugestię `review`; bez flag kategoria produktowa/komercyjna
pozostaje w obserwacji, a pozostałe podlegają progowi kontaktu. Sugestia nie
jest decyzją ani jej wykonaniem. Wynik zawiera źródło i punkty każdej reguły.
Identyfikator zapisu jest stabilny dla oceny, factsRef i rulesVersion.
Wiele utrwalonych prób kroku score jest obecnie odrzucane jako niejednoznaczne.

Nie podłączono dopływu faktów z O2/K1/badania. Nie należy włączać pełnego
szkieletu, aby sprawdzić tę partię. TC-PHOTOGRAPHERS-025 uruchamia rzeczywisty
wycinek `start → score → disposition` z własnymi materiałami testowymi;
w tym teście `disposition` jest końcem, a nie zastępczą decyzją biznesową.
