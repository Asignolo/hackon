# Zintegrowane demo Photographers

Gałąź `codex/integrated-photographer-demo`, worktree `/private/tmp/hackon-integrated-demo`.
Scalone źródła: `3908e5ae`, `fb906e84`, `eb785f85`, `bf19ba71`.

## Uruchomienie

1. Uruchom aplikację z tej gałęzi i jej standardowe workery.
2. Otwórz `/backend/photographers/simulator`, zapisz imię, nazwisko, e-mail i portfolio. Wpis `brak` pozostaje obsługiwanym wejściem bez portfolio.
3. Poczekaj na przygotowanie CRM, wybierz „Oceń tego fotografa” i uruchom ocenę na ekranie demo.
4. Wybierz „Zobacz zapisaną ocenę”. Link zawiera evaluationId i registrationId; można wracać do niego i odświeżać wynik.

API: `POST /api/photographers/demo-evaluations` z `{requestId,registrationId}`.
Stan: `GET /api/photographers/demo-evaluations/:requestId`.
Ponowne dostarczenie: `POST /api/photographers/demo-evaluations/:requestId` z `{}`.
Odczyt: `GET /api/photographers/assessments/:evaluationId?registrationId=...`.

## Konfiguracja

- Moduły photographers, customers, workflows, agent_orchestrator, agent_examples, integration_apify oraz istniejące moduły procesu/kolejek/schedulera.
- `OM_ENABLE_ENTERPRISE_MODULES=true`, `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`; `yarn generate`, build pakietów/aplikacji i restart aplikacji/workerów po zmianach rejestracji.
- Działający OpenCode i skonfigurowany dostawca modelu, zarejestrowani `agent_examples.portfolio_reader_o1` i `photographers.apify_link_researcher_o2`.
- Token i włączona integracja Apify przez istniejący moduł dostawcy, jego health check, limiter i budżet. Nie zwiększano limitów; domyślny budżet może dać częściowy wynik.
- Standardowe kolejki `agent-process-executions`, `photographers-demo-workflow`, `photographers-portfolio-discovery`, `photographers-apify-research` oraz obsługa zdarzeń procesu.
- Dla istniejącego tenanta po włączeniu modułu agentów trzeba zasilić jego mapy szyfrowania; sama flaga i klucz nie wystarczają. Procedura i ograniczenia: `PROCESS-FIX.md`.
- Zainstalowane ustawienia Photographers/CRM dla organizacji (pipeline, etapy, reguły), szyfrowanie danych rejestracji/CRM/audytu, materiałów, AgentRun input/output i podsumowań AgentToolCall.
- Uprawnienia Photographers run/view/manage i rejestracji, CRM, procesów/workflow, agentów/śladów, `agent_orchestrator.web_search`, `integration_apify.research`. Pierwsze utworzenie definicji procesu wymaga processes.manage.

Nie dodano migracji. Nie zmieniano konfiguracji rzeczywistej bazy użytkownika ani tokenów usług.

## Przepływ i awarie

Workflow v3: start → przygotowanie → O1 → zapis O1 → przygotowanie O2 → Apify O2 → odczyt zapisanego manifestu → zapis faktów → odczyt faktów i istniejący kalkulator → zapis oceny → koniec.

Referencje końcowe: `context.demoScore.result`. Reguły: `context.demoRules`, zamrożone raz przy starcie. Wszystkie materiały są związane z tą samą oceną, rejestracją, fotografem, osobą CRM i szansą. O1/O2 oraz zapis materiałów są idempotentne dla ponownego dostarczenia.

Źródła O1 są w demo przyjęte jako należące do fotografa. Braki pozostają nieznane. Kategoria opiera się wyłącznie na jawnych specjalizacjach PL/EN; niejednoznaczne opisy pozostają unknown. Bez zmian reguł punktacji, weryfikacji tożsamości i wysyłki wiadomości.

Trwały błąd/configuration failure daje FAILED, bez oceny udającej sukces. Częściowy wynik zachowuje dostępne dane i braki. Niejednoznaczne przerwanie płatnego wywołania nie rozpoczyna nowego runu; wymaga ręcznego wyjaśnienia. Nie ma automatycznego odzyskiwania utraconej sesji modelu.

Aktywne v1/v2 nie są migrowane. Utwórz nowy requestId; jeśli definicja w bazie przesłania kod, operator musi przywrócić definicję kodową v3 albo opublikować zgodny graf. Start odrzuca niezgodną definicję.

## Dowody

Wyniki walidacji są w `VALIDATION.md`. Kontrolowany test podstawia klienta zewnętrznego OpenCode (odpowiedzi modelu/OUTCOME); nie podstawia API, silnika workflow, workerów, runtime, magazynu ani kalkulatora. Nie jest dowodem rzeczywistego połączenia z modelem czy Apify. Płatnych testów nie uruchomiono.
