# Proces oceny fotografa („ukryty potencjał”)

Słownik pojęć: [CONTEXT.md](../CONTEXT.md). Ten dokument opisuje przebieg, nie definicje.

## 1. Cel weekendu

Demo wygrywa z testem platformy. Import fotografów (100–200 na weekend) i pola własne są warunkiem demo, więc test migracji załatwia się przy okazji. Wiele marek w jednej bazie i własne moduły z własnym interfejsem: tylko pytania do mentorów, bez kodu.

## 2. Model danych w Open Mercato

| Pojęcie | Obiekt w Open Mercato | Co trzyma |
|---|---|---|
| Fotograf | rekord `customers`, odmiana **osoba** | imię, nazwisko, e-mail, portfolio; fakty trwałe jako pola własne profilu osoby (NIP, status CEIDG, PKD, data startu, VAT, miasto, platforma galerii, ślady) |
| Szansa | szansa sprzedażowa w lejku „Ukryty potencjał”, **jedna na fotografa** | aktualne punkty, propozycja, flagi, „dlaczego”, potencjał w PLN jako wartość; etap = stan w kolejce |
| Ocena | aktywność na szansy | data, punkty, sygnały, różnica wobec poprzedniej oceny, „dlaczego” |
| Następna ocena | pole „następna interakcja” na fotografie | data kolejnego przebiegu w rosnącym odstępie |

Firma nie jest osobnym rekordem: klienci to w większości jednoosobowe działalności bez działu kontaktowego. Rekord firmy pojawi się dopiero przy migracji zamówień i fakturowania.

## 3. Lejek „Ukryty potencjał”

Etapy w kolejności wędrówki szansy:

1. **Nowa**: po imporcie, przed pierwszą oceną.
2. **W badaniu**: trwa pierwsza ocena. Kolejne oceny dzieją się w miejscu, z wpisem w historii.
3. **Obserwowana**: oceniona, poniżej progu, bez flag. Czeka na kolejną ocenę. Tu siedzi większość bazy.
4. **Do weryfikacji**: ocena znalazła flagę. Człowiek decyduje.
5. **Do kontaktu**: powyżej progu, bez flag, szkic wiadomości gotowy. Człowiek wysyła jednym kliknięciem.
6. **Skontaktowana**: wiadomość poszła.
7. **Zamknięta**: wygrana (fotograf zamówił) albo przegrana z powodem.

„Nie ustalono” nie jest flagą. Jest sygnałem „nieznane”, który nie daje punktów i zostawia szansę w „Obserwowana”. Flagą jest tylko to, co agent ustalił na pewno i co jest złe: działalność zawieszona, wykreślona, PKD niefotograficzne.

## 4. Wyzwalacze

- **Partia**: porcja fotografów z bazy w zadanej kadencji. Na weekend: 100–200 fotografów wgranych do Open Mercato i badanych na żywo; nie ma nocnego przebiegu na 3404. Kadencja produkcyjna: do ustalenia.
- **Nowa rejestracja**: natychmiast po formularzu.

Oba wyzwalacze uruchamiają ten sam przebieg.

## 5. Fazy oceny i ich mapowanie na Agent Orchestrator

| Faza | Co robi | Rodzaj wyniku w Orchestratorze | Kto zatwierdza |
|---|---|---|---|
| Odkrycie | z czterech kotwic rejestracji ustala ślady i ich pewność | propozycja „tożsamość fotografa”, pewność = stopień pewności śladów | auto, gdy pewny; Caseload w wąskim paśmie (jeden kandydat, jedna poszlaka); poniżej pasma „nic nie proponuję”, kandydaci zostają w wyniku |
| Badanie | po pewnych śladach zbiera fakty | `research` | nikt; działa tylko na pewnych śladach |
| Punktacja | deterministyczna funkcja z faktów: kategoria, punkty, flagi, propozycja etapu | krok zautomatyzowany opakowany w propozycję „przenieś szansę na etap X”; flaga zbija pewność do zera | auto powyżej progu bez flag; inaczej Caseload |
| Opieka | szkic pierwszej wiadomości dopasowany do platformy i kategorii | propozycja „wyślij wiadomość”, ryzyko akcji **wysokie** | zawsze człowiek, bo sufit ryzyka polityki to „średnie” |

Zasady platformy, na których to stoi (kod na gałęzi `develop`, moduł `agent_orchestrator`):

- Propozycja dostaje „auto” tylko po przejściu pięciu bramek: włącznik polityki, brak blokady strażnika, kompletny ślad wykonania, ryzyko akcji nie wyżej niż sufit, pewność powyżej progu. Powód zatrzymania jest zapisany.
- Zatrzymana propozycja tworzy zadanie użytkownika, przepływ czeka na sygnał, sprawa pojawia się w **Caseload**. Operator zatwierdza, poprawia albo odrzuca z obowiązkowym powodem. Zapis do CRM idzie dopiero po decyzji, przez szynę komend; agent nigdy nie pisze do bazy sam.
- Każda poprawka człowieka staje się przypadkiem testowym agenta.
- Polityka auto-zatwierdzania jest ustawiana na poziomie firmy (Ustawienia → Auto-zatwierdzanie); próg pewności można wpisać w krok przepływu.

Caseload jest jedyną kolejką dla człowieka. Tablica lejka pokazuje stan całej populacji, ale decyzje zapadają w Caseload. Na scenie: decyzja w Caseload, karta przeskakuje na tablicy.

## 6. Odkrycie

### 6.1 Kotwice

Dokładnie cztery, wszystkie z rejestracji: imię, nazwisko, e-mail, portfolio. NIP, miasto, telefon to wyniki odkrycia, nie jego początek.

Rozkład pola portfolio w bazie (7215 wpisów): adres na Instagramie 29%, sama nazwa konta 24%, adres na Facebooku 24%, własna domena 15%, śmieć 4%, inna platforma 3%, system galerii 1%.

### 6.2 Stopnie pewności śladu

- **Pewny**: ślad dał sam fotograf (portfolio, domena z e-maila) albo zgadzają się dwa niezależne fakty.
- **Prawdopodobny**: zgadza się jeden fakt, zwykle samo nazwisko. Kandydat jest zapisany, nie daje punktów, nie tworzy faktów.
- **Nie ustalono**: kilku kandydatów bez rozstrzygnięcia albo zero trafień. Kandydaci i powód zapisane.

Twarda reguła: odkrycie nigdy nie wybiera jednego z kilku kandydatów. Trzech Kowalskich bez miasta to „nie ustalono”.

### 6.3 Cztery ścieżki

1. **Portfolio → profil.** Adres lub nazwa konta na Instagramie albo Facebooku daje ślad pewny od razu. Samą nazwę konta sprawdzamy najpierw na Instagramie, potem na Facebooku. Z opisu profilu wyciągamy poszlaki: miasto, własną stronę, e-mail kontaktowy, czasem NIP.
2. **Domena → strona → stopka.** Własna domena z portfolio lub z e-maila daje ślad pewny „strona”. Podstrony „kontakt”, „regulamin”, „polityka prywatności” dają poszlaki: NIP, miasto.
3. **E-mail → wyszukiwarka → agregator firm.** E-mail w cudzysłowie w wyszukiwarce; trafienia w agregatorach dają kandydata na firmę z NIP-em i miastem. Poszlaki, nie ślad. Narzędzie: gotowe pakiety wyszukiwania w sieci Open Mercato (Exa, Firecrawl, Tavily, SearXNG).
4. **Nazwisko → CEIDG.** Na końcu, bo daje najwięcej kandydatów. Zawęża się miastem lub PKD z poszlak.

### 6.4 Reguła potwierdzenia

Wpis w CEIDG lub w wykazie VAT jest śladem pewnym tylko, gdy nazwisko z wpisu zgadza się z nazwiskiem z rejestracji **i** zgadza się co najmniej jedna poszlaka z innej ścieżki: miasto, NIP ze stopki, domena wpisana w CEIDG, PKD fotograficzne. NIP z agregatora bez zgodności nazwiska nigdy nie jest potwierdzeniem. Dopiero pewny wpis daje fakty: NIP, status, PKD, data startu, miasto, status VAT.

### 6.5 Gdy portfolio nic nie daje

Odkrycie próbuje pozostałych ścieżek (domena z e-maila, e-mail w wyszukiwarce, nazwisko), a gdy wszystkie się wyczerpią, zapisuje fakt „portfolio: brak” z powodem (puste, śmieć, martwy link, link bez tożsamości) i odkłada szansę do „Obserwowana” z najdłuższym odstępem. Człowiek nic nie widzi. Dotyczy najwyżej 4% bazy. Poza weekendem: sklep powinien przestać przyjmować „brak” w polu portfolio (Vendure, nie Open Mercato).

### 6.6 Tożsamość na karcie

Karta w Caseload pokazuje u góry blok „Tożsamość”: każdy ślad, jego pewność i dowód, na przykład „CEIDG: pewny, nazwisko + Wrocław + PKD 74.20”. Jedno kliknięcie odrzuca zły ślad; ocena liczy się od nowa bez niego.

## 7. Badanie

Badanie jest pełne dla każdego fotografa, bez warstw i bez skrótów: każde pewne źródło jest odpytywane w każdej ocenie. Wielkość partii ogranicza koszt, nie zakres badania.

### 7.1 Katalog faktów

Każdy fakt ma typ. Brak danych to zawsze „nieznane”, nigdy zero ani „nie”.

| Źródło | Fakty |
|---|---|
| Instagram | istnieje (tak/nie), liczba postów, obserwujący, data ostatniego posta, zaangażowanie, pokazuje produkty drukowane (tak/nie/nieznane), wzrost obserwujących |
| Facebook | to samo co Instagram |
| Pinterest | istnieje, liczba pinów, obserwujący |
| Strona | istnieje, rodzaj (własna strona / kreator stron / brak), aktualna (tak/nie), kalendarz rezerwacji (tak/nie) |
| System galerii | jedna wartość z listy: Zalamo, Mafelo, Photonesto, Fotoklaser, Fotigo, Pixieset, Pic-Time, nPhoto, inny, brak. Sam fakt, bez klasyfikacji „z laboratorium / bez laboratorium” |
| Google Maps | wizytówka istnieje, liczba opinii, średnia ocena, odpowiada na opinie (tak/nie), data ostatniej opinii |
| Rejestry | NIP, REGON, KRS (jeśli spółka), status (aktywna / zawieszona / wykreślona), data startu, PKD główne, PKD fotograficzne (tak/nie), VAT czynny (tak/nie), miasto, przychód z KRS (tylko spółki) |

### 7.2 Definicje faktów, które trzeba liczyć tak samo w każdym agencie

- **Zaangażowanie**: średnia z polubień i komentarzy na ostatnich 12 postach podzielona przez liczbę obserwujących.
- **Pokazuje produkty drukowane**: w ostatnich 12 postach jest zdjęcie albumu, odbitki, oprawy lub wzmianka o druku. Model językowy ocenia z opisów i zdjęć; odpowiedź tak / nie / nieznane.
- **Wzrost obserwujących**: różnica między dwiema ocenami. Przy pierwszej ocenie zawsze „nieznane”.

## 8. Punktacja

Punktacja jest deterministyczną funkcją z faktów. Wszystkie wagi, progi i bramki są **konfigurowalne** (konfiguracja modułu, nie kod) i poniższe wartości są **propozycją startową do dalszej ewaluacji** na poprawkach z Caseload. Każda spełniona reguła jest jedną linijką w „dlaczego” na karcie.

### 8.1 Kategoria

Kategoria fotografa jest faktem z badania, nie elementem punktacji. Model językowy przypisuje ją z treści portfolio: ślubny, rodzinny i noworodkowy, szkolny i przedszkolny, reportażowy i eventowy, produktowy i komercyjny, inny, nieznane. Kategoria służy opiece (treść wiadomości) i jednej bramce: produktowy i komercyjny nie idzie do kontaktu niezależnie od punktów.

### 8.2 Reguły punktowe (propozycja startowa)

Z doświadczeń Crystal Albums trzy fakty najmocniej odróżniają najlepszych klientów od reszty: potwierdzony NIP, firma starsza niż dwa lata, czynny VAT. Dlatego mają najwyższe wagi.

| Obszar | Reguła | Punkty |
|---|---|---|
| Firma | NIP potwierdzony w rejestrze | 20 |
| Firma | firma starsza niż 2 lata | 20 |
| Firma | VAT czynny | 15 |
| Firma | PKD fotograficzne | 5 |
| Media | pokazuje produkty drukowane | 10 |
| Media | Instagram: ostatni post młodszy niż 30 dni | 5 |
| Media | Instagram: obserwujący ≥ 1000 | 5 |
| Media | Instagram: zaangażowanie ≥ 3% | 5 |
| Media | Facebook: ostatni post młodszy niż 30 dni | 5 |
| Strona | własna domena | 5 |
| Strona | aktualna | 5 |
| Strona | kalendarz rezerwacji | 5 |
| Galeria | system galerii znany | 5 |
| Google | wizytówka z ≥ 20 opiniami | 5 |
| Google | ocena ≥ 4,7 | 5 |

Suma obcięta do 100. „Nieznane” daje zero i nie odejmuje.

### 8.3 Próg i flagi

- Próg „do kontaktu”: **60** (konfigurowalny).
- Flagi: działalność zawieszona, działalność wykreślona, PKD niefotograficzne. Flaga omija próg: szansa idzie do weryfikacji, nigdy automatycznie do kontaktu ani do odrzucenia.
- Pewność propozycji „przenieś na etap”: wyliczona z punktów; flaga zbija ją do zera.

### 8.4 Ewaluacja wag

Po weekendzie: porównać fakty 100–200 zbadanych fotografów z faktami obecnych najlepszych klientów i skorygować wagi. Poprawki operatora w Caseload są przypadkami testowymi, więc ewaluacja ma dane od pierwszego dnia.

## 9. Opieka

Opieka pisze **pełną treść pierwszej wiadomości** i zgłasza ją jako propozycję „wyślij wiadomość” z ryzykiem akcji „wysokie”. Sufit ryzyka w polityce to „średnie”, więc propozycja zawsze zatrzymuje się w Caseload. Człowiek zatwierdza, poprawia albo odrzuca z powodem.

Na weekend zatwierdzenie **nie wysyła** wiadomości. Zapisuje na szansy interakcję „wiadomość zatwierdzona do wysłania” z treścią i przesuwa szansę na „Skontaktowana”. Wysyłka odbywa się ręcznie poza systemem.

Treść wiadomości:

- krótka, trzy zdania, jedna konkretna propozycja (próbka, test druku),
- dopasowana do kategorii i systemu galerii (ślubnemu na Pixieset inaczej niż szkolnemu na Zalamo),
- **nie zdradza faktów z badania**: pisze tylko o tym, co fotograf sam nam dał (portfolio). Liczba obserwujących, VAT, opinie Google są wiedzą opiekuna, nie treścią.

Obok treści karta pokazuje „dlaczego”: spełnione reguły punktowe i fakty, na których stoi wiadomość.

Poza weekendem: prawdziwa wysyłka przez gotowe kanały Open Mercato (Gmail, IMAP, Resend, SES), odpowiedź wracająca na szansę, ponowna opieka po N dniach ciszy.

## 10. Dane, import i RODO

Pseudonimizacja przed odkryciem jest niemożliwa: trzy z czterech kotwic (imię, nazwisko, portfolio) to właśnie to, co miałoby być ukryte. Dlatego rozdzielamy przetwarzanie od pokazywania.

- **Przetwarzanie na prawdziwych danych.** 100–200 prawdziwych rejestracji w instancji Open Mercato na maszynie lub serwerze zespołu, nie u organizatora. Podstawa: zarejestrowani klienci, relacja B2B, prawnie uzasadniony interes. Do dokumentacji RODO (Justyna): cykliczne odpytywanie sieci o fotografów to nowy cel przetwarzania.
- **Pokazywanie partii tylko jako liczb i identyfikatorów.** Na scenie i na wideo: „F-0137, 78 punktów, ślubny, Pixieset”. Zero nazwisk z bazy.
- **Karty na żywo z osób, które się zgodziły.** Nagranie i pokaz na koncie żony Andrzeja, za jej zgodą. Druga karta (zatrzymana na fladze) też z osoby, która się zgodziła, albo z identyfikatorem.
- **Regulamin „bez wrażliwych danych firmy”**: lista klientów jest wrażliwą daną firmy. Do repozytorium i do organizatora idzie kod, konfiguracja i zrzuty z identyfikatorami, nigdy eksport bazy.

Import: cztery pola z rejestracji (imię, nazwisko, e-mail, portfolio) dla 100–200 fotografów bez zamówień, do rekordów typu osoba w module `customers`. Nic więcej nie jest importowane; wszystko inne odkrywają i badają agenci.

## 11. Demo

Proces na scenie kończy się na **zatwierdzonej propozycji w Caseload**, żeby ostatni krok był w Orchestratorze, nie poza nim.

1. Rejestracja wpada jako zdarzenie. Szansa powstaje w „Nowa”, przechodzi przez „W badaniu”: widać przebiegi agentów, wywołania narzędzi, ślady z pewnością i dowodem.
2. Punktacja proponuje „przenieś na Do kontaktu” z wysoką pewnością: auto-zatwierdzone, karta przeskakuje na tablicy.
3. Opieka proponuje gotową wiadomość z ryzykiem „wysokie”: zatrzymuje się w Caseload z powodem „ryzyko akcji”. Operator czyta, klika „zatwierdź”. Interakcja zapisana, szansa na „Skontaktowana”.
4. Druga rejestracja: odkrycie znajduje działalność zawieszoną, flaga, pewność zero, karta w „Do weryfikacji”, w Caseload widać powód. Operator odrzuca z powodem; na ekranie pojawia się nowy przypadek testowy agenta.

Karta przechodząca całą ścieżkę: żona Andrzeja (fotograf, zgoda). Partia 100–200: tylko liczby i identyfikatory. Zdanie na koniec: „jedyna praca człowieka w całym procesie to to jedno kliknięcie i to jest decyzja, nie brak”.
