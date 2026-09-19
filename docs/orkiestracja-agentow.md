# Propozycja orkiestracji „Ukryty potencjał”

Aktualizacja 19.09.2026: jeden agent O1 wykonuje odkrycie, a K1 sprawdza przypisanie śladów. Osobny O2 został usunięty. [Diagram i szczegółowy przepływ O1 → K1](przeplyw-do-rozmowy-z-zespolem.md) opisują ten podział.

Status: projekt do wdrożenia, 19.09.2026. Podstawa: [proces oceny](proces-oceny.md), [słownik](../CONTEXT.md) i cztery ADR. Poniższy podział ról oraz doprecyzowania są rekomendacją; nie zmieniają automatycznie wcześniejszych ustaleń.

## Podział odpowiedzialności

Proponuję czterech agentów korzystających z modelu językowego i osobny kod do odczytu rejestrów. Open Mercato uruchamia ich we właściwej kolejności i czeka na wymagane decyzje człowieka. Jedna ocena dotyczy jednego fotografa. Badanie dzielimy na trzy części, które mogą działać równolegle. Opieka zaczyna się dopiero po zebraniu wyników i zatwierdzeniu kwalifikacji do kontaktu.

| Rola | Wejście | Zadanie i wynik | Granica odpowiedzialności |
|---|---|---|---|
| O1 Odkrycie | Cztery dane z rejestracji: imię, nazwisko, e-mail, portfolio | Rozpoznaje portfolio i wyszukuje po e-mailu także bez portfolio. Wynik: `research`, źródła i ocena pewności. | Nie rozstrzyga przypisania za K1, nie odpytuje rejestrów i nie ocenia potencjału. |
| K1 Tożsamość — kod | Rejestracja i wynik O1 | Sprawdza reguły przypisania oraz przekazuje propozycje przez politykę zatwierdzania. | Ocena modelu nie jest decyzją tego kroku. |
| A2 Media społecznościowe | Potwierdzone ślady Instagram, Facebook, Pinterest; poprzednia ocena | Zbiera aktywność, obserwujących, posty i sygnały druku. Wynik: `research`, ze źródłem i czasem odczytu. | Model interpretuje treść i zdjęcia; zaangażowanie i wzrost oblicza kod. Nie przypisuje kategorii ani punktów. |
| A3 Portfolio i obecność w sieci | Potwierdzone portfolio, strona, galeria i Google Maps | Ustala kategorię z portfolio, rodzaj i aktualność strony, rezerwacje, system galerii i opinie Google. Wynik: `research`. | Jedyny właściciel kategorii. Może czytać treść portfolio ze społeczności, ale pomiary tych kont należą do A2. |
| R1 Rejestry — wykonawca narzędzi | Potwierdzony przez odkrycie ślad CEIDG/KRS i identyfikatory | Pobiera status działalności, NIP, datę startu, PKD, VAT oraz dostępne dane KRS. Wynik: fakty w tym samym kontrakcie co `research`. | Preferowany zwykły kod i API. Nie wymaga osobnego modelu językowego. Nie zgaduje tożsamości i nie wystawia flag. |
| A4 Opieka | Zatwierdzona kwalifikacja do kontaktu, kategoria, system galerii, dozwolony kontekst portfolio | Pisze trzy zdania i jedną propozycję, np. próbkę lub test druku. Wynik: propozycja wiadomości do Caseload. | Bez wysyłki i bez ujawniania VAT, liczby obserwujących czy opinii Google. Wewnętrzne „dlaczego” jest osobnym polem. |

O1 czyta portfolio, stronę i kontakt, a brakujące ślady wyszukuje po e-mailu, nazwisku lub marce. Brak portfolio nie pomija poszukiwań. Domena publicznej poczty, np. gmail.com, nie jest własną stroną fotografa. Kandydaci NIP mogą pochodzić ze stron, ale O1 nie odpytuje CEIDG, KRS ani VAT. Poszukiwanie kandydatów w rejestrach pozostaje przyszłym rozszerzeniem. K1 sprawdza przypisanie każdego śladu; kilka kopii jednego źródła nie stanowi niezależnych potwierdzeń.

## Co robimy z czterema polami rejestracji

Na początku mamy tylko imię, nazwisko, e-mail i portfolio. Telefon, miasto, NIP czy nazwa firmy mogą pojawić się dopiero w wyniku odkrycia. Nie zakładamy, że znamy je z rejestracji.

Całą rejestrację dostaje O1. Pozostali agenci pracują przede wszystkim na śladach, które O1 znalazł, K1 sprawdził i które przeszły zatwierdzanie. Proponuję zachować oryginalne wartości pól, a oczyszczone adresy i znalezione informacje zapisywać osobno. Dzięki temu da się sprawdzić, co podał fotograf, a co ustalił agent.

- **Imię i nazwisko** pomagają O1 porównać osobę z rejestracji z osobą opisaną na stronie lub profilu. Samo zgodne nazwisko nie wystarcza do wybrania jednego z kilku kandydatów.
- **E-mail** daje O1 dwie drogi poszukiwania: własną domenę po znaku `@` oraz wyszukanie pełnego adresu w cudzysłowie. Trafienie w agregatorze firm jest śladem niepotwierdzonym do sprawdzenia. Użycie e-maila do odkrycia nie uruchamia wysyłki wiadomości.
- **Portfolio** jest pierwszym miejscem, które O1 sprawdza, bo wskazał je sam fotograf. Może zawierać adres strony lub profilu, samą nazwę konta, adres galerii albo bezużyteczny wpis. O1 rozpoznaje tę postać i ustala, dokąd prowadzi.

Po odkryciu dane rozchodzą się według zadań: konta społecznościowe do A2, portfolio i obecność w sieci do A3, potwierdzone wpisy rejestrowe do R1. A4 dostaje dane potrzebne do przygotowania wiadomości dopiero na końcu.

## O1. Odkrycie: znajduje ślady ze źródłami

O1 dostaje cztery pola rejestracji. Najpierw wyszukuje pełny e-mail w cudzysłowie. Czyta dostępne portfolio i odsyłacze, sprawdza stronę oraz kontakt, informacje o autorze i informacje prawne. Sprawdza kandydatów z wyszukiwania i uzupełnia brakujące ślady przez nazwisko, markę lub własną domenę. Puste albo martwe portfolio nie kończy zadania.

Zwraca jeden wynik `research`: stronę, kontakt, Instagram, Facebook, Google Maps, kandydatów NIP i miasto, ze źródłami, oceną pewności oraz informacją o wykonanych i nieukończonych poszukiwaniach. Wspólny budżet to 10 wyszukiwań, 15 odczytów, głębokość dwa i pięć minut. O1 nie odpytuje rejestrów, nie mierzy aktywności i nie nadaje punktów.

## K1. Tożsamość: sprawdza przypisanie śladów

K1 porównuje wynik O1 z oryginalną rejestracją według reguł domenowych. Ocena `confirmed` nadana przez model nie zastępuje tej kontroli. Portfolio wskazane przez fotografa jest potwierdzone z definicji; inne ślady wymagają odpowiednich dowodów i polityki zatwierdzania.

**Przekazuje dalej:** ślady dopuszczone do badania oraz zapis nierozstrzygniętych kandydatów. Jeden kandydat z jednym zgodnym śladem może trafić do Caseload. Kilku kandydatów bez rozstrzygnięcia pozostaje niepotwierdzonych. Zakończone poszukiwania bez użytecznych śladów mogą prowadzić do Obserwowana z najdłuższym odstępem; awaria lub wyczerpanie budżetu nie oznaczają ukończonych poszukiwań.

## A2. Media społecznościowe: zbiera fakty o aktywności i druku

A2 dostaje potwierdzone konta Instagram, Facebook i Pinterest oraz wyniki poprzedniej oceny. Korzysta więc z wyniku pracy nad rejestracją: nie szuka ponownie fotografa po samym nazwisku.

Na Instagramie i Facebooku zbiera liczbę postów i obserwujących, datę ostatniego posta oraz dane do obliczenia zaangażowania. Czyta opisy i ogląda dostępne zdjęcia z ostatnich 12 postów. Ustala, czy fotograf pokazuje albumy, odbitki, oprawy albo wspomina o druku. Na Pintereście zbiera fakty przewidziane w katalogu: istnienie konta, liczbę pinów i obserwujących.

Model interpretuje treść i zdjęcia. Wspólna funkcja oblicza zaangażowanie z polubień, komentarzy i liczby obserwujących. Porównuje też liczbę obserwujących z poprzednią oceną. Przy pierwszej ocenie wzrost pozostaje nieznany. Jeśli źródło jest niedostępne, A2 zapisuje ten stan; nie zastępuje brakujących liczb zerami ani braku dostępu odpowiedzią „nie pokazuje druku”.

**Przekazuje dalej:** fakty w wyniku `research`, wraz ze źródłem i czasem odczytu. Punktacja użyje tych faktów do zastosowania reguł. A2 nie nadaje punktów i nie decyduje o kategorii fotografa.

## A3. Portfolio i obecność w sieci: ustala specjalizację i sposób prezentowania pracy

A3 dostaje potwierdzone portfolio, stronę, galerię i wizytówkę Google Maps. Portfolio pochodzi z rejestracji lub ze śladów potwierdzonych przez K1. Może prowadzić do konta społecznościowego; własna strona nie jest warunkiem wykonania tej części badania.

Z treści portfolio A3 przypisuje kategorię: ślubny, rodzinny i noworodkowy, szkolny i przedszkolny, reportażowy i eventowy, produktowy i komercyjny, inny albo nieznane. Jeśli treść nie pozwala rozstrzygnąć, pozostawia „nieznane”. W proponowanym podziale to A3 odpowiada za kategorię w całym procesie.

Na stronie sprawdza jej rodzaj, aktualność i obecność kalendarza rezerwacji. Rozpoznaje system galerii według listy z dokumentacji, np. Zalamo, Mafelo, Pixieset lub Pic-Time. Z potwierdzonej wizytówki Google Maps zbiera liczbę opinii, średnią ocenę, datę ostatniej opinii i informację, czy fotograf odpowiada na opinie.

Jeśli portfolio jest na Instagramie lub Facebooku, A3 korzysta z jego treści do określenia kategorii. Liczby dotyczące konta pozostają zadaniem A2. Proponuję udostępniać obu agentom ten sam materiał pobrany w danej ocenie, żeby nie pobierali go ponownie tylko z powodu podziału ról.

**Przekazuje dalej:** kategorię i pozostałe fakty jako `research`, ze źródłami i czasem odczytu. Kategoria i system galerii pomogą A4 dopasować wiadomość. Punktacja sprawdzi też regułę, która wyklucza kontakt dla kategorii produktowy i komercyjny niezależnie od punktów.

## R1. Rejestry: odczytuje potwierdzone dane działalności

R1 dostaje potwierdzony ślad CEIDG lub KRS oraz ustalone identyfikatory. Nie dostaje zadania „znajdź firmę tej osoby” na podstawie samego formularza. To powiązanie musi wcześniej sprawdzić K1. Obecny O1 zbiera kandydatów NIP ze stron; wyszukiwanie wpisów rejestrowych pozostaje do wdrożenia.

R1 odczytuje NIP, REGON, KRS, status działalności, datę rozpoczęcia, PKD i miasto, a także sprawdza status VAT. Dla spółek zbiera dostępne dane o przychodzie z KRS zgodnie z katalogiem faktów. Zwraca tylko to, co udało się ustalić; niedostępny wpis lub brak odpowiedzi pozostawia jako „nieznane” z powodem.

**Przekazuje dalej:** fakty rejestrowe ze źródłem i datą sprawdzenia. Kod punktacji wyliczy wiek działalności, przyzna punkty i ustawi flagę, jeśli potwierdzono zawieszenie, wykreślenie lub niefotograficzne PKD.

R1 proponuję wykonać zwykłym kodem wywołującym odpowiednie narzędzia. Odczyt uporządkowanych pól i dat nie wymaga osobnego modelu językowego.

## A4. Opieka: przygotowuje pierwszą wiadomość

A4 zaczyna pracę po zatwierdzeniu kwalifikacji do kontaktu. Dostaje kategorię, system galerii oraz kontekst portfolio, który wolno wykorzystać w wiadomości. Imię z rejestracji może służyć do zwrotu do fotografa, a oryginalny e-mail do wskazania adresata propozycji. Rekomenduję, żeby znaleziony w sieci inny adres nie zastępował automatycznie adresu podanego przez fotografa.

A4 pisze pełną wiadomość: trzy zdania i jedną konkretną propozycję, np. próbkę lub test druku. Dopasowuje ją do specjalizacji i sposobu pracy fotografa. Oddziela treść dla fotografa od wewnętrznego uzasadnienia dla operatora. Wiadomość może nawiązywać do portfolio podanego przy rejestracji; ustalenia o VAT, obserwujących czy opiniach Google pozostają poza jej treścią.

**Przekazuje dalej:** gotową treść jako propozycję w Caseload. Propozycja ma wysokie ryzyko, a dodatkowo rekomenduję `alwaysAsk: true`. Operator zatwierdza ją, poprawia lub odrzuca z powodem.

A4 nie wysyła wiadomości. Na demo zatwierdzenie zapisuje treść i przesuwa szansę do Skontaktowana, a wysyłka odbywa się ręcznie poza systemem. Docelową wysyłkę wykonuje osobny krok po decyzji człowieka.

## Co zostaje po pracy agentów

Na fotografie zapisujemy potwierdzone ślady i fakty. Na jednej szansie tego fotografa zapisujemy bieżące punkty, flagi, propozycję i etap. Każda kolejna ocena dopisuje aktywność z datą, wynikiem, zmianami i uzasadnieniem.

Agenci zwracają wyniki, a zapis wykonują komendy uruchamiane przez przepływ. Fakty z badania nie wymagają osobnej decyzji człowieka. Propozycje tożsamości, zmiany etapu i wiadomości przechodzą właściwe zasady zatwierdzania.

Jeśli operator odrzuci błędny ślad, kolejna ocena pomija go oraz oparte na nim ustalenia. Dzięki zapisaniu źródła każdego faktu wiadomo, które wyniki trzeba ponownie sprawdzić lub przeliczyć.

## Przepływ jednej oceny

1. **Start — kod przepływu.** Nowa rejestracja lub partia uruchamia ten sam proces. Sprawdzenie braku zamówień, jednej szansy na fotografa, braku zamknięcia i braku już trwającej oceny. Pierwsza ocena: Nowa → W badaniu; kolejne nie cofają etapu.
2. **O1 Odkrycie → K1 Tożsamość.** O1 zbiera źródła także bez portfolio; K1 sprawdza przypisanie. Potwierdzone ślady przechodzą politykę zatwierdzania. Wąski przypadek „jeden kandydat, jeden zgodny ślad” trafia do Caseload. Wieloznaczność to brak propozycji, nie prośba do człowieka o wykonanie całego badania. Jeśli istnieją inne potwierdzone ślady, badanie może objąć tylko je. Brak jakiegokolwiek użytecznego śladu po wyczerpaniu ścieżek → Obserwowana i 180 dni.
3. **Zapis zaakceptowanej tożsamości — komenda.** Po decyzji operatora przepływ używa poprawionej wersji. Odrzucony ślad nie trafia do badania.
4. **A2, A3 i R1 — badanie równoległe.** Każdy bada wszystkie potwierdzone ślady ze swojego zakresu. Brak śladu daje wynik „nieznane”; awaria źródła ma oddzielny status i ograniczone ponowienia. Koszt kontrolujemy wielkością partii i współbieżnością, nie skracaniem badania.
5. **Scalenie — kod.** Czeka na zakończenie wszystkich trzech gałęzi, także zakończenie błędem lub niedostępnością. Sprawdza typy, źródła i aktualność faktów oraz wykrywa sprzeczne wyniki. Nie wymyśla wartości. Fakty zapisuje przez komendy na fotografie; `research` nie wymaga zatwierdzenia człowieka.
6. **Punktacja — kod.** Oblicza sumę reguł, obcina do 100, wyprowadza flagi i uzasadnienie. Flaga → Do weryfikacji i Caseload. Bez flag, kategoria produktowy i komercyjny → Obserwowana. Pozostali: ≥60 → kwalifikacja do kontaktu; <60 → Obserwowana. Przeniesienie etapu przechodzi politykę propozycji.
7. **A4 Opieka.** Wyłącznie po zatwierdzonej kwalifikacji. Propozycja wiadomości ma ryzyko wysokie i rekomendowane `alwaysAsk: true`. Gdy szkic jest gotowy, szansa spełnia definicję Do kontaktu. Do tego czasu należy pokazywać stan przygotowania opieki, a nie sugerować gotowość wiadomości.
8. **Caseload — operator.** Zatwierdzenie lub edycja pozwala wykonać konkretną zaakceptowaną akcję. Odrzucenie pomija tę akcję; samo w sobie nie oznacza przegranej szansy. Poprawka wraz z powodem staje się przypadkiem testowym.
9. **Zapis i termin — kod.** Aktualizacja szansy, aktywność oceny, różnica względem poprzedniej oceny i następny termin. Zamknięcie wygrane po pierwszym zamówieniu, na demo ręcznie; przegrane wyłącznie decyzją człowieka z powodem.

Na demo zatwierdzenie wiadomości zapisuje interakcję „wiadomość zatwierdzona do wysłania” i przesuwa do Skontaktowana zgodnie z §9 procesu. To nie jest potwierdzenie wysyłki. W produkcji rekomendujemy zmianę etapu dopiero po potwierdzeniu wysłania przez kanał; bez tego miara pierwszego zamówienia w 90 dni od kontaktu będzie zafałszowana.

## Co należy do Orchestratora i zwykłego kodu

- Przepływ: wyzwalacze, zależności, uruchomienia agentów, oczekiwanie na człowieka, wznowienie po decyzji, rozgałęzienia i wykonanie komend.
- Reguły domenowe: potwierdzenie śladu, obliczenia liczbowe, walidacja faktów, punktacja, flagi, termin następnej oceny i blokada równoczesnych ocen.
- Zapis: wykonawca komendy, nigdy swobodne narzędzie zapisu dostępne modelowi. Decyzje biznesowe jako propozycje, fakty z badania jako zatwierdzony typ wyniku `research`.
- Ewaluacja: poprawki operatora jako przypadki testowe, wersje reguł i instrukcji. Zmiana wag po analizie, bez automatycznego „uczenia się” reguł w trakcie oceny.

Proponowane zabezpieczenia wykonania: identyfikator oceny wspólny dla gałęzi, izolacja organizacji, blokada jednej aktywnej oceny na fotografa, limity czasu i ponowień, zapis odporny na powtórzenie tej samej komendy oraz sprawdzenie aktualnej wersji danych przed zastosowaniem propozycji. Decyzja o pierwszym zamówieniu lub zamknięciu unieważnia oczekujące akcje kontaktowe.

## Co zawiera wynik każdego kroku

| Wynik | Minimalna zawartość |
|---|---|
| Ślad | typ, adres/identyfikator, status (potwierdzony / niepotwierdzony), skąd, czas sprawdzenia |
| Fakt | nazwa, typowana wartość lub „nieznane”, identyfikator potwierdzonego śladu, źródło, czas odczytu, właściciel pola, status odczytu |
| Punktacja | wersja reguł, identyfikator zestawu faktów, spełnione reguły z punktami, suma, flagi, kategoria, proponowany etap |
| Wiadomość | treść, dozwolone fakty użyte w treści, wewnętrzne uzasadnienie, ryzyko, wersja zestawu faktów |
| Ocena | fotograf, szansa, identyfikator oceny, daty, wyniki gałęzi, różnica, decyzje, wersje instrukcji i reguł |

Zaangażowanie liczy wspólna funkcja; przy braku dostępu do postów lub zerowym mianowniku zwraca „nieznane”. Wzrost przy pierwszej ocenie także jest nieznany. Niedostępności źródła nie należy interpretować jako zmiany faktu; wcześniejszy odczyt pozostaje w historii, ale nie udaje aktualnego pomiaru.

## Doprecyzowania względem dokumentacji

1. **Kategoria należy do badania.** Przyjmujemy szczegółowy §8.1 i ADR 0003, mimo skrótów w słowniku i tabelach sugerujących wyliczanie kategorii przez punktację.
2. **Punkty i pewność decyzji są różnymi miarami.** Dokument wiąże pewność z punktami, a jednocześnie oczekuje automatycznej obserwacji poniżej progu. Rekomendacja: pewność propozycji oznacza poprawność zastosowania reguły do zweryfikowanego zestawu faktów; niski potencjał nie oznacza niepewnej decyzji „Obserwowana”. Flagi nadal wymagają człowieka. Nie używać po prostu `punkty / 100` jako pewności. To wymaga akceptacji zmiany reguły domenowej.
3. **Do weryfikacji przed decyzją.** Jeśli zapis etapu też czeka na zatwierdzenie, tablica nie pokaże od razu Do weryfikacji. Rekomendacja: deterministyczna komenda ustawia ten techniczny stan oczekiwania, a zatrzymana propozycja dotyczy dalszego postępowania. Operator dostaje konkretne opcje; flaga sama nie zamyka szansy.
4. **Do kontaktu oznacza gotową treść.** §0 i demo ustawiają etap przed opieką, definicja etapu wymaga gotowego szkicu. Rekomendacja: zatwierdzić kwalifikację przed A4, a widoczny etap ustawić po przygotowaniu szkicu. Stan przygotowania ma pozostać widoczny w wykonaniu procesu.
5. **Zegar stoi podczas każdej oczekującej decyzji.** Rozszerzenie reguły etapów o oczekiwanie na tożsamość zapobiega powtórnemu badaniu tej samej osoby. Po decyzji 14 dni; bez zmian 14 → 28 → 56 → 112 → 180; zmiana faktu resetuje do 14; zamknięcie kończy oceny.

## Weryfikacja z Open Mercato

Sprawdzono źródła `develop` 19.09.2026; drzewo repozytorium wskazywało commit `83330e271e0da0e0ae8ed4dd4d83369735cc06e6`. Moduł znajduje się w `packages/enterprise`, nie `packages/core`.

- [Demo przepływu](https://github.com/open-mercato/open-mercato/blob/83330e271e0da0e0ae8ed4dd4d83369735cc06e6/packages/enterprise/src/modules/agent_orchestrator/DEMO.md): `INVOKE_AGENT`, Caseload, pauza/wznowienie, wykonawca zatwierdzonej lub edytowanej akcji; odrzucenie pomija wykonanie.
- [Polityka zatwierdzania](https://github.com/open-mercato/open-mercato/blob/83330e271e0da0e0ae8ed4dd4d83369735cc06e6/packages/enterprise/src/modules/agent_orchestrator/lib/disposition/autoApprovalPolicy.ts): `alwaysAsk`, włącznik polityki, strażnik, ślad wykonania, ryzyko, próg pewności i opcjonalny margines między opcjami.
- [Format propozycji](https://github.com/open-mercato/open-mercato/blob/83330e271e0da0e0ae8ed4dd4d83369735cc06e6/packages/enterprise/src/modules/agent_orchestrator/data/proposalEnvelope.ts): aktualny kontrakt `options[]`, z akcjami, pewnością i uzasadnieniem opcji. Kod wspiera też starszy format.

Nazwy O1, K1, A2–A4 i R1 są naszym projektem ról. Równoległe badanie, reguły domenowe i adapter deterministycznej punktacji do propozycji wymagają wdrożenia i testu na używanej wersji platformy; nie są gotowym przepływem dostarczanym przez te przykłady.
