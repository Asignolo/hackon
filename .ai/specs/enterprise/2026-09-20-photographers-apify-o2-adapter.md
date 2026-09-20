# Photographers: trwały adapter istniejącego Apify O2

Status: implemented slice; integration pending. Rozszerza
[spec MVP](2026-09-19-photographer-hidden-potential-mvp.md).

## Cel i granice

Zapisany AgentRun o1 oraz jego tracesRef → istniejący
photographers.apify_link_researcher_o2 → trwały szyfrowany wynik związany z fotografem,
rejestracją, osobą CRM, szansą i evaluationId. Tożsamość jest założeniem wejściowym
demo; brak klasyfikacji, punktowania, zmian głównego workflow i nowych providerów.

## Kontrakt

Funkcja workflow photographers.apify_o2.dispatch przyjmuje {o1RunId,tracesRef}.
Worker photographers-apify-research wykonuje agentRuntime.run poza transakcją
workflow. Krok apify_o2 czeka na photographers.apify_o2.ready i otrzymuje
{apifyResearchRef,apifyRunId,apifyResearchStatus}. Odczyt:
readApifyResearchResult(researchRef, CommandRuntimeContext).

Materiały apify_research (niezmienna rezerwacja / manifest końcowy) oraz
apify_research_part rozszerzają istniejący magazyn. OUTCOME nie ulega zmianie.
String resultJson, źródła o1, czas odczytu, null, unavailableFields i diagnostyki
pozostają zachowane; części zapewniają zapis powyżej limitu jednego materiału.

## Idempotencja i błędy

Blokada zakresowana organizacją i tracesRef + trwały claim przed runtime + stabilne
invocationId + unikalność run frameworka. Powtórzenie odczytuje run lub manifest.
Niejednoznaczne przerwanie pozostaje pending i nigdy nie uruchamia nowego run.
Błąd terminalny zachowuje surowe wyjście i ślady; nie fabrykuje OUTCOME.
Brak konfiguracji i limit budżetu są diagnostykami obecnego narzędzia.
Szczegóły odzyskiwania i ograniczenia śladów: dokument przekazania.

## Migration & Backward Compatibility

Zmiany addytywne w photographers; istniejące enum warianty, importy, API, DI i
photographers.o2.store_result pozostają zachowane. Tabela materiałów już ma tekstowy
kind i zaszyfrowany body, więc migracja nie jest potrzebna. Nowa funkcja DI i worker
wymagają generate. Konsumenci nowego wyniku korzystają z helpera lub istniejącego
GET materiałów; poprzednie rodzaje materiałów zachowują limit 128 KiB i format.

## Weryfikacja i integracja

Kontrolowane testy: częściowy wynik, brak konfiguracji, budżet, błąd, odtworzenie
po nieudanym zapisie, duży wynik, wielokrotne dostarczenie, powiązania oceny i ACL,
szyfrowany zapis/odczyt przez istniejący magazyn. Brak nowych tras lub UI;
istniejący GET materiałów i jego testy regresyjne obsługują nowe warianty.
Integracja live z workflow i podglądem należy do agenta integrującego i wymaga
skonfigurowanej aplikacji. Żadne testy nie wywołują płatnych narzędzi.

Dokładne argumenty, wynik, rejestracje i instrukcja integracji:
[HANDOFF](../../runs/2026-09-20-apify-o2/HANDOFF.md).

## Changelog

2026-09-20: adapter, trwała rezerwacja i magazyn wieloczęściowy, kontrolowane testy.
