# Rejestracja → O1 → zapis śladów

Source doc: `.ai/specs/enterprise/2026-09-19-photographer-hidden-potential-mvp.md`

## Zakres

Domknąć istniejący wycinek odkrycia w module aplikacyjnym `photographers`: odczyt oryginalnej rejestracji, przygotowanie powiązań CRM, uruchomienie O1 i zapis niepotwierdzonych śladów w szyfrowanym magazynie materiałów. Workflow i kolejka przenoszą identyfikatory, a wynik jest skorelowany z konkretnym wykonaniem kroku.

Pełny szkielet pozostaje wyłączony. K1, dalsze badanie, automatyczny start dla bazy i nowe ekrany nie należą do tej iteracji. Bez zmian frameworka, migracji ani resetu środowiska.

## Weryfikacja

Testy jednostkowe autoryzacji, zakresu, korelacji i ponowień. Test integracyjny z rzeczywistą rejestracją testową, CRM, silnikiem workflow, uruchomieniem agenta i zapisem materiału; kontrolowana odpowiedź zastępuje wyłącznie zewnętrzne OpenCode. Wariant z portfolio i wariant „brak”. Sprawdzenie szyfrowania i braku treści źródłowych w stanie sterowania. Wynik testu nie oznacza sprawdzenia jakości wyszukiwania w sieci.

## Progress

- [x] Przygotowanie wejścia i bezpieczne przekazanie wyniku przez istniejący graf.
- [x] Testy jednostkowe i integracyjne obu wariantów rejestracji.
- [x] Przegląd, wymagane kontrole oraz aktualizacja dokumentacji (istniejące błędy pełnej bramki opisane poniżej).

## Wyniki weryfikacji

Runner: local, po sprawdzeniu braku uruchomionego kontenera compose app.

- Moduł fotografów: 35 zestawów / 319 testów jednostkowych PASS.
- Kontrola typów aplikacji oraz lint zmienionego kodu i testu integracyjnego PASS.
- Build packages → generate → build packages PASS. Synchronizacja tłumaczeń PASS.
- Kontrola użycia tłumaczeń PASS; 7914 nieużywanych kluczy zgłoszonych doradczo w całym repozytorium.
- Kontrola typów całego repozytorium FAIL: istniejące błędy core dla nieaktywnych modułów, m.in. WMS i resources, których identyfikatorów nie zawiera rejestr tej aplikacji. Nie zmieniono frameworka w celu obejścia tych błędów.
- Pełne `yarn test` FAIL w core: katalog ACL oczekuje pięciu etykiet aplikacyjnego modułu fotografów w core auth locale; test warranty_claims nie odnajduje wygenerowanego `entities/warranty_claim_registration` dla wyłączonego modułu. Core: 1947 zestawów PASS, 2 FAIL, 1 pominięty; 17605 testów PASS, 1 FAIL, 2 pominięte. Nie zmieniono tych powierzchni. Wymagana pełna bramka nie jest zielona.
- Końcowa kompilacja odizolowanej aplikacji PASS. TC-PHOTOGRAPHERS-024: 2/2 PASS, bez ponowień i pominięć; rejestracja z portfolio 9,9 s, bez portfolio 2,7 s. Osobna baza i aplikacja, natywny Playwright z pełnym środowiskiem testowym. Potwierdzono szyfrowany zapis i odczyt śladów, status unconfirmed, brak danych źródłowych w stanie workflow oraz brak duplikatu po ponowieniu zadania. Zewnętrzny klient OpenCode kontrolowany; pozostała ścieżka rzeczywista.
- Ponowna kontrola typów aplikacji i lint testu integracyjnego po jego końcowych poprawkach PASS. Niezależny przegląd końcowy: brak nowych uwag blokujących. `git diff --check` PASS.
- Dowody: [podsumowanie TC024](./2026-09-19-photographer-o1-evidence.json).

Przegląd ujawnił brak kontroli map szyfrowania zapisów narzędzi; dodano tę kontrolę i regresję. Test używa wspieranego rejestratora DI, aby kontrolowany klient OpenCode trafił także do nowego kontenera workera. Produkcyjny worker zachowuje normalny bootstrap. Nie deklarujemy odzyskania zdalnej sesji przerwanej twardym zakończeniem procesu ani obsługi osobnego principal przez `grantedFeatures`; bieżący wyłączony graf nie deklaruje takich grantów.
