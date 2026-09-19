# Apify Research Provider for Agent Orchestrator

## 📝 TLDR

Powstanie publiczny pakiet Marketplace `@open-mercato/integration-apify` z modułem `integration_apify`, który udostępni file-agentom OpenCode cztery wąskie, typowane narzędzia read-only względem domeny Open Mercato do publicznych danych z Instagrama, Facebooka i Google Maps. Narzędzia tworzą płatne runy i usuwają ich storage po stronie providera, więc nie są bezskutkowym odczytem sieciowym. Integracja będzie warstwą pozyskania danych dla pełnego etapu discovery klienta, ale nie będzie sama orkiestrować discovery ani modyfikować `agent_examples.portfolio_reader_o1`.

Każde wywołanie przejdzie przez default-off ACL, aktywny `AgentRun`, tenant-wide credentials, zamknięty katalog Actorów z numerycznie przypiętym buildem, konserwatywną rezerwację kosztu, limity liczby elementów/czasu/współbieżności oraz provider-specific normalizer. Model nie otrzyma dostępu do Apify MCP, tokenu, dowolnego Actor ID, dowolnego inputu ani surowego datasetu.

## 📝 Overview

### Cel

Zapewnić Agent Orchestratorowi bezpieczną, audytowalną i kosztowo ograniczoną warstwę researchu, którą przyszły agent pełnego discovery klienta wykorzysta obok analizy portfolio, wyszukiwania WWW i innych źródeł. Provider ma zbierać wyłącznie publiczne sygnały biznesowe, normalizować je do stabilnych kontraktów i jawnie zgłaszać brak lub niepewność danych.

### Rozstrzygnięte decyzje

| Obszar | Decyzja |
| --- | --- |
| Klient Apify | Oficjalny `apify-client`, ukryty za provider-owned `lib/client.ts`; `maxRetries: 0` dla operacji tworzących lub zmieniających run. |
| Katalog wykonawczy | Bezpośrednie wywołania allowlistowanych Actorów z dokładnym numerycznym buildem. Apify Tasks, tagi takie jak `latest` i dowolne Actor IDs są zabronione. |
| Model wykonania | Synchroniczny i ograniczony dla małych wyników MVP; asynchroniczny worker jest osobnym przyszłym zakresem. |
| Dystrybucja | Publicznie instalowalny pakiet OSS/Marketplace bez importów z enterprise; produkcyjne uruchamianie płatnych tools wymaga runtime Agent Orchestratora i aktywnego `AgentRun`. |
| Retencja | Brak nowego magazynu providera. Raw output istnieje tylko w pamięci podczas normalizacji i jest usuwany best effort z domyślnych storage Apify. |
| O1 | Podłączenie do `agent_examples.portfolio_reader_o1` lub budowa docelowego agenta discovery wymaga osobnej specyfikacji capability. |
| Dane osobowe | Publiczne strony firm, miejsca i publiczne profile zawodowe/biznesowe; bez prywatnych kont, profili osobistych Facebooka, follower lists i tożsamości autorów opinii. |
| Zakres prawny | Bazowy profil zgodności UE/EOG; operator nadal odpowiada za cel, podstawę prawną, regulaminy źródeł, DPA oraz obsługę praw osób. |
| ACL | Jedna funkcja egress `integration_apify.research`, domyślnie nieprzyznawana rolom; konfiguracja integracji pozostaje w standardowym ACL Marketplace. |

### Referencje rynkowe i techniczne

- Oficjalny klient JavaScript Apify zapewnia typowane resource clients, lecz automatycznie ponawia 429, 5xx i błędy sieciowe; dlatego provider jawnie wyłącza retry dla uruchamiania płatnych runów: [Apify JS client](https://docs.apify.com/api/client/js/docs), [error handling](https://docs.apify.com/api/client/js/docs/concepts/error-handling).
- `Actor.call()` obsługuje `build`, `maxItems`, `maxTotalChargeUsd` i `timeout`; `maxTotalChargeUsd` chroni tylko Actorów w modelu pay-per-event, więc dla pay-per-result wymagany jest dodatkowo katalogowy limit kosztu na element i `maxItems`: [ActorCallOptions](https://docs.apify.com/api/client/js/reference/interface/ActorCallOptions).
- Tagi buildu są ruchome, a pełny numer `MAJOR.MINOR.BUILD` identyfikuje pojedynczy build; produkcja używa wyłącznie tego drugiego: [Actor builds](https://docs.apify.com/actors/development/builds-and-runs/builds).
- Katalog MVP opiera się na [Instagram Profile Scraper](https://apify.com/apify/instagram-profile-scraper), [Facebook Pages Scraper](https://apify.com/apify/facebook-pages-scraper), [Google Maps Scraper](https://apify.com/compass/crawler-google-places) i [Google Maps Reviews Scraper](https://apify.com/compass/google-maps-reviews-scraper).
- Google Maps Reviews Scraper domyślnie dopuszcza dane osobowe, dlatego adapter zawsze wymusza `personalData: false` i nie przyjmuje tego pola od modelu: [input schema](https://apify.com/compass/google-maps-reviews-scraper/input-schema).
- Domyślne storage runu i retencja Apify są zewnętrznym obszarem zgodności. Provider wykonuje best-effort cleanup po normalizacji, a operator utrzymuje odpowiedni plan i politykę workspace: [datasets](https://docs.apify.com/storage/dataset), [runs and builds](https://docs.apify.com/actors/running/runs-and-builds).

## 📝 Problem Statement

Dzisiejszy file-agent `agent_examples.portfolio_reader_o1` potrafi czytać portfolio z podanego URL i korzystać z ogólnych narzędzi WWW, ale nie ma stabilnego, bezpiecznego kontraktu dla publicznych sygnałów społecznościowych i lokalnych. Bez dedykowanego providera model musiałby otrzymać szeroki Apify MCP lub generyczne `run_actor`, co tworzy kilka problemów:

- model mógłby wybrać dowolny Actor, input, rozmiar datasetu i profil kosztowy;
- retry po niejednoznacznym błędzie mogłby uruchomić drugi płatny run;
- token Apify i surowe dane miałyby większą powierzchnię ekspozycji;
- schematy Actorów mogą zmieniać się niezależnie od kontraktów Open Mercato;
- brak danych, blokada platformy i wartość zero mogłyby zostać pomylone;
- koszty nie byłyby przypisane do konkretnego `AgentRun` i tenanta;
- dane osobowe lub nieograniczona treść opinii mogłyby trafić do promptu i trace.

Pełny etap discovery potrzebuje wielu źródeł, ale każde źródło musi mieć własny wąski kontrakt. Ta specyfikacja rozwiązuje wyłącznie warstwę Apify: pozyskanie, ograniczenie, normalizację i diagnostykę danych publicznych.

## 📝 Proposed Solution

### Zakres MVP

Provider rejestruje cztery `defineAiTool`:

1. `integration_apify.scrape_instagram_profile`
2. `integration_apify.scrape_facebook_page`
3. `integration_apify.scrape_google_maps_place`
4. `integration_apify.scrape_google_maps_reviews`

Wszystkie narzędzia mają `isMutation: false`, `requiredFeatures: ['integration_apify.research']`, wejście walidowane przez Zod i stabilny, serializowalny wynik. `isMutation: false` oznacza wyłącznie brak mutacji domeny Open Mercato; narzędzia tworzą płatny zewnętrzny egress i dlatego wymagają aktywnego `AgentRun`, budżetu i dedykowanego default-off ACL.

Operational surfaces objęte MVP:

- Marketplace manifest, tenant-wide credentials i standardowy health check;
- dedykowany ACL, AgentRun correlation oraz per-run/per-tenant quota i cost reservation;
- provider-owned env preset i CLI konfigurujące bez ujawniania sekretu;
- pinned actor catalog, normalizatory, redakcja, cleanup zewnętrznego storage i telemetry;
- testy unit/integration/MCP/Marketplace, jawny live canary oraz dokumentacja operacyjna.

### Poza zakresem

- posty, Reels, Stories, komentarze, polubienia, engagement i listy obserwujących;
- Pinterest, okresowe snapshoty i obliczanie wzrostu followersów;
- prywatne konta, ich publiczne metadata, obchodzenie logowania, CAPTCHA lub blokad platformy;
- profile osobiste Facebooka i identyfikacja autorów Google Reviews;
- własne Apify Actors, Apify Tasks, generyczny `run_actor`, dowolny Actor ID lub dowolny input;
- NIP, REGON, KRS, CEIDG i status VAT; przyszłe narzędzia muszą korzystać z oficjalnych rejestrów;
- nowe encje, snapshoty researchu, harmonogramy, automatyczne odświeżanie i data sync;
- logika syntezy discovery, scoring klienta, rekomendacje, mutacje domenowe i podłączenie do O1;
- asynchroniczne runy, callbacki i długie datasety.

### Rozważone alternatywy

| Alternatywa | Powód odrzucenia w MVP |
| --- | --- |
| Bezpośredni Apify MCP | Zbyt szeroka powierzchnia narzędzi, wejść i koszt poza kontrolą providera. |
| Generyczne `run_actor` | Model kontrolowałby Actor ID i arbitrary input; brak stabilnego kontraktu i audytu. |
| Apify Tasks | Operator może zmienić ukryty input, build lub zakres poza PR-em i testami repozytorium. |
| Wąski klient REST | Mniej zależności, ale duplikacja autoryzacji, timeoutów, typów i obsługi zasobów; adapter nad oficjalnym klientem zachowuje możliwość zamiany. |
| Worker od pierwszej wersji | Zwiększa zakres o job lifecycle, polling UI i retencję. Cztery ograniczone narzędzia mieszczą się w synchronicznym tool loopie. |
| Snapshoty w bazie OM | Zwiększają ryzyko prywatności i wymagają modelu retencji. AgentRun/trace już utrwala potrzebny ograniczony wynik. |
| Dodanie Apify do O1 w tym samym PR | Łączy niezależny provider z decyzjami orkiestracji i promptu konkretnego agenta. |

## 📝 Architecture

### Granice modułów

- `packages/integration-apify/` jest samodzielnym workspace package i modułem `integration_apify`.
- Pakiet rejestruje Marketplace manifest z `id: 'integration_apify'`, `category: 'other'` i `hub: 'agent_orchestrator'`.
- Provider nie dodaje logiki Apify do `packages/core` ani nie importuje `packages/enterprise`.
- Agent Orchestrator konsumuje narzędzia przez istniejące auto-discovery `defineAiTool` i MCP bridge.
- Zależność instalacyjna od Agent Orchestratora jest miękka, ale wykonawcza jest twarda: pakiet rozwiązuje przez DI `agentRunSessionStore`; brak usługi lub aktywnego runu wyłącza płatne narzędzie fail closed, ale nie blokuje konfiguracji i health checku Marketplace.
- Token jest rozwiązywany na każde wywołanie przez `integrationCredentialsService` z pełnym `organizationId` i `tenantId`, `userId: null`; nie jest singletonem ani polem globalnego klienta.
- Pakiet korzysta z istniejących usług DI do credentials, rate limiting, integration logs i error reporting. Nie tworzy własnego ORM relationship z modułem enterprise.

### Przepływ wywołania

```text
file-agent
  -> MCP tool discovery + per-call ACL
  -> input/schema i public-scope validation
  -> AgentRun resolution from context.sessionId
  -> atomic quota/cost reservation + concurrency lease
  -> scoped tenant-wide credential resolution
  -> closed actor catalog lookup
  -> one Apify Actor run with exact build and bounded input
  -> bounded status polling for the same actorRunId
  -> bounded dataset fetch
  -> provider-specific normalization and redaction
  -> best-effort Apify storage cleanup
  -> stable result envelope + structured metrics
  -> quota lease release
```

Jeżeli start runu zwróci błąd niejednoznaczny, provider nie uruchamia kolejnego runu. Retry jest dozwolone wyłącznie dla idempotentnych `GET` statusu lub datasetu już znanego `actorRunId`, w ramach tego samego deadline i maksymalnie dwa razy z jitterem. Nigdy nie retry'uje `POST` uruchamiającego run ani nie „wskrzesza” zakończonego/utraconego wywołania.

### Katalog Actorów

`lib/actor-catalog.ts` jest jedynym miejscem z informacją wykonawczą. Każdy wpis zawiera:

- stabilny wewnętrzny klucz narzędzia;
- dokładny Actor ID;
- dokładny numeryczny build `MAJOR.MINOR.BUILD`, bez tagów;
- spodziewany hash wejściowego schematu i wersję fixture outputu;
- model cenowy (`pay_per_event` lub `pay_per_result`) i konserwatywny koszt jednostkowy;
- fabrykę dozwolonego inputu; żadne dodatkowe pole od modelu nie jest kopiowane;
- twarde `maxItems`, deadline i maksymalny rozmiar datasetu;
- funkcję normalizującą i wersję jej kontraktu.

Katalog MVP:

| Narzędzie | Actor | Limit elementów | Uwagi wejściowe |
| --- | --- | ---: | --- |
| Instagram profile | `apify/instagram-profile-scraper` | 1 | Jedna nazwa użytkownika lub canonical URL. |
| Facebook page | `apify/facebook-pages-scraper` | 1 | Jeden publiczny URL strony; profile osobiste są odrzucane. |
| Google Maps place | `compass/crawler-google-places` | 1 | Jeden Google Maps URL albo Place ID; brak zapytania tekstowego/search radius. |
| Google Maps reviews | `compass/google-maps-reviews-scraper` | 10 domyślnie, 25 maks. | Jeden URL/Place ID, `personalData: false`, `reviewsOrigin: 'google'`. |

Dokładne numery buildów nie są wybierane przez model ani env. Implementacja w fazie katalogu zapisuje aktualny, zweryfikowany numer i fixture w repozytorium. Zmiana buildu wymaga osobnego PR-u, contract tests i udokumentowanego live canary poza CI; `latest`, `beta` i inne ruchome tagi nie przechodzą testu statycznego.

### Limity kosztu i częstotliwości

Provider implementuje cienki `apifyQuotaService` nad `rateLimiterService`. Każde wywołanie przed odczytem tokenu atomowo rezerwuje najgorszy dopuszczalny koszt w całkowitych milli-USD oraz punkt wywołania. Rezerwacja w MVP nie jest zwracana po tańszym wyniku; to celowo konserwatywny limit ryzyka, a nie księga kosztów.

Domyślne limity produkcyjne:

| Limit | Wartość domyślna | Twarda granica |
| --- | ---: | ---: |
| `maxTotalChargeUsd` per run | 0.25 USD | 0.50 USD |
| timeout Actora | 120 s | 180 s |
| elementy profile/page/place | 1 | 1 |
| reviews | 10 | 25 |
| rozmiar znormalizowanego wyniku | 64 KiB | 64 KiB |
| wywołania per `AgentRun` | 4 | 8 |
| budżet ryzyka per `AgentRun` | 0.50 USD | 1.00 USD |
| wywołania per tenant / godzina | 30 | 120 |
| budżet ryzyka per tenant / godzina | 5.00 USD | 20.00 USD |
| współbieżność globalna / proces | 4 | 8 |
| współbieżność per tenant | 2 | 4 |

Wartości z env mogą jedynie obniżyć lub podnieść wartość do twardej granicy skompilowanej w kodzie. Model nie kontroluje limitu kosztu ani timeoutu. `maxTotalChargeUsd` jest przekazywane Actorowi, gdy wspiera go model pay-per-event. Brak obsługiwanego katalogowego modelu cenowego blokuje run. Health check nie wykrywa zmian cennika ani schematu; ich kontrola należy do procedury aktualizacji katalogu, a wykonanie zachowuje limity kosztu i walidację wyniku.

Paid egress działa fail closed, gdy `rateLimiterService` jest niedostępny, wyłączony lub zgłasza degradację. W instalacji wieloprocesowej wymagany jest współdzielony backend Redis; pamięciowy limiter jest dozwolony tylko dla jednego procesu i developmentu. Lease współbieżności ma TTL `deadline + 30 s` i jest zwalniany w `finally`.

### Credential i health flow

- Definicja credentials zawiera wyłącznie sekret `apiToken`, tenant-wide (`userId: null`).
- `preset.ts` może zapisać token z `OM_INTEGRATION_APIFY_API_TOKEN` dla jawnie wskazanych tenant/org; nie loguje wartości i nie nadpisuje istniejących credentials bez `--force`.
- CLI: `yarn mercato integration_apify configure-from-env --tenant <id> --org <id> [--force]`.
- Health check wykonuje wyłącznie jedno uwierzytelnione `user().get()`, bez retry, z timeoutem HTTP 3 s i limitem odpowiedzi 256 KiB. Nie pobiera metadanych Actorów/buildów ani nie uruchamia płatnych Actorów.
- Health check ma awaryjny deadline 10 s i zwraca sanitizowany wynik: `healthy`, `invalid_credentials` albo `upstream_unavailable`. Potwierdza token i łączność, nie zgodność schematów/cenników. Kontrola katalogu pozostaje w procedurze aktualizacji przypiętych buildów; limity kosztów wykonania pozostają bez zmian.

## 📝 Data Model

MVP nie dodaje tabel ani migracji.

### Dane trwałe

- token jest przechowywany przez istniejący zaszyfrowany `integrationCredentialsService`;
- metadata konfiguracji i health checku wykorzystują istniejące encje modułu integrations;
- znormalizowany wynik toola, diagnostyka i `actorRunId` podlegają istniejącej retencji `AgentRun`/trace;
- limity czasowe i rezerwacje kosztu są krótkotrwałymi kluczami w istniejącym `rateLimiterService`.

### Dane nietrwałe

Raw dataset jest trzymany wyłącznie w pamięci procesu do czasu normalizacji. Po utworzeniu wyniku provider próbuje usunąć domyślny dataset, key-value store i request queue runu przez ich konkretne IDs. Cleanup nie usuwa samego rekordu runu, bo `actorRunId` jest potrzebne do audytu, a Apify może utrzymywać metadata według polityki workspace.

Niepowodzenie cleanup nie zmienia poprawnego wyniku biznesowego na porażkę, ale dodaje diagnostykę `cleanup_failed`, zapisuje sanitizowany błąd integracji i uruchamia `reportError` ze stabilnym reason. Raw payload ani URL zawierający parametry wrażliwe nie trafia do logu.

### Typy wewnętrzne

Każdy normalizer rozróżnia trzy stany pola:

1. wartość jawnie zwrócona przez Actor;
2. `null` wraz z wpisem `unavailableFields`;
3. błąd schematu, gdy pole ma nieoczekiwany typ lub semantykę.

Liczba `0` jest zachowywana tylko wtedy, gdy pole było obecne i Actor jawnie zwrócił zero. Brak pola nigdy nie staje się zerem, pustym stringiem lub pustą tablicą udającą kompletny wynik.

## 📝 API Contracts

### Brak nowego publicznego HTTP API

Pakiet nie dodaje provider-specific REST routes. Konfiguracja credentials i health korzysta z istniejących endpointów Marketplace, a file-agent wywołuje narzędzia przez istniejący MCP bridge. Ewentualne przyszłe HTTP API wymaga oddzielnej specyfikacji i kontraktu kompatybilności.

### Wspólna koperta wyniku

Każde narzędzie zwraca:

```ts
type ApifyResearchResult<T> = {
  ok: boolean
  status: 'complete' | 'partial' | 'no_data' | 'error'
  platform: 'instagram' | 'facebook' | 'google_maps'
  canonicalUrl: string | null
  sourceUrl: string | null
  observedAt: string
  actorRunId: string | null
  data: T | null
  unavailableFields: Array<{
    field: string
    reason: 'not_exposed' | 'not_found' | 'private' | 'platform_blocked' | 'schema_changed' | 'redacted'
  }>
  diagnostics: Array<{
    code: ApifyDiagnosticCode
    severity: 'info' | 'warning' | 'error'
    message: string
    retryable: false
    partial: boolean
  }>
}
```

`message` jest krótkim, bezpiecznym tekstem przeznaczonym dla modelu, bez tokenu, raw response, stack trace i danych osoby. `retryable` w MVP jest zawsze `false`, aby agent samoczynnie nie generował kolejnego kosztu; człowiek może rozpocząć nowe wywołanie po diagnozie.

`ApifyDiagnosticCode` jest zamkniętą unią:

```text
not_configured | run_context_missing | budget_exceeded | concurrency_limited |
invalid_target | unsupported_public_scope | upstream_unauthorized |
upstream_forbidden | upstream_rate_limited | upstream_unavailable | timeout |
platform_blocked | no_data | partial_dataset | schema_changed | output_truncated |
cleanup_failed
```

Odmowa ACL następuje w MCP bridge przed handlerem i nie tworzy wyniku ani kosztu.

### `integration_apify.scrape_instagram_profile`

Wejście:

```ts
{ profileUrlOrUsername: string }
```

- akceptuje pojedynczy username lub URL `instagram.com/<username>`;
- odrzuca URL posta, Reels, Stories, hashtag, wyszukiwanie i listę profili;
- po canonicalizacji przekazuje Actorowi wyłącznie jedną nazwę użytkownika.
- po minimalnym odczycie wymaga jednoznacznego sygnału konta biznesowego albo profesjonalnego/creator; profil prywatny lub niepotwierdzony profil osobisty zwraca `unsupported_public_scope`, `data: null`, a odczytane metadata są odrzucane.

`data`:

```ts
{
  username: string
  displayName: string | null
  biography: string | null
  followersCount: number | null
  followingCount: number | null
  postsCount: number | null
  isVerified: boolean | null
  isPrivate: boolean | null
  accountType: 'business' | 'creator'
  businessCategory: string | null
  externalUrl: string | null
}
```

`biography` ma limit 2 000 znaków. Jeżeli Actor nie pozwala wiarygodnie potwierdzić `business` albo `creator`, provider kończy wynikiem poza zakresem; nie zgaduje typu konta. Próba obejścia prywatności jest zabroniona.

### `integration_apify.scrape_facebook_page`

Wejście:

```ts
{ pageUrl: string }
```

- wymaga HTTPS i hosta należącego do dozwolonego zestawu domen Facebooka;
- akceptuje wyłącznie pojedynczą publiczną stronę/firmę;
- wykryty profil osobisty, grupa, post lub event zwraca `unsupported_public_scope` przed płatnym runem, gdy możliwe, albo po minimalnej klasyfikacji wyniku bez ujawniania danych profilu.

`data`:

```ts
{
  name: string | null
  category: string | null
  description: string | null
  followersCount: number | null
  likesCount: number | null
  rating: number | null
  ratingCount: number | null
  website: string | null
  businessEmail: string | null
  businessPhone: string | null
  address: string | null
  isVerified: boolean | null
}
```

`description` ma limit 2 000 znaków. Email i telefon są zwracane wyłącznie, gdy strona publikuje je jako dane firmy.

### `integration_apify.scrape_google_maps_place`

Wejście:

```ts
{ placeUrl?: string; placeId?: string }
```

Dokładnie jedno pole jest wymagane. URL musi wskazywać konkretny obiekt Google Maps; zapytania tekstowe, kategorie, obszary i promienie są odrzucane. `placeId` ma ograniczoną długość i dozwolony alfabet.

`data`:

```ts
{
  placeId: string | null
  name: string | null
  primaryCategory: string | null
  categories: string[] | null
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  reviewsCount: number | null
  priceLevel: string | null
  temporarilyClosed: boolean | null
  permanentlyClosed: boolean | null
  coordinates: { latitude: number; longitude: number } | null
}
```

Lista `categories` jest deduplikowana i ograniczona do 20 pozycji.

### `integration_apify.scrape_google_maps_reviews`

Wejście:

```ts
{
  placeUrl?: string
  placeId?: string
  maxReviews?: number
  sort?: 'most_relevant' | 'newest'
}
```

Dokładnie jedno z `placeUrl`/`placeId` jest wymagane. `maxReviews` domyślnie wynosi 10 i jest clampowane do 1–25. Adapter zawsze wymusza `personalData: false`, `reviewsOrigin: 'google'` i nie przekazuje dowolnych opcji Actora.

`data`:

```ts
{
  placeId: string | null
  placeName: string | null
  rating: number | null
  reviewsCount: number | null
  sampleSize: number
  sampledReviews: Array<{
    rating: number | null
    text: string | null
    publishedAt: string | null
    ownerResponse: string | null
  }>
}
```

Provider usuwa nazwę, avatar, URL profilu, lokalny identyfikator i inne identyfikatory autora. Tekst opinii jest ograniczony do 1 000 znaków, odpowiedź właściciela do 500 znaków, a cały wynik do 64 KiB. Przekroczenie limitu kończy dalsze pobieranie i zwraca `partial` z `output_truncated`.

## 📝 UI/UX

MVP nie dodaje niestandardowych ekranów.

- Integracja pojawia się w istniejącym Marketplace pod nazwą „Apify Research”, w kategorii `other`, powiązana z hubem Agent Orchestrator.
- Standardowy formularz credentials wyświetla jedno pole sekretne „API token”; wartość po zapisie nie jest odczytywana z powrotem.
- Standardowy health panel pokazuje status, czas ostatniej kontroli i sanitizowaną przyczynę. Nie pokazuje fragmentu tokenu, IDs storage ani raw upstream response.
- Funkcja `integration_apify.research` jest widoczna w standardowym zarządzaniu rolami, ale nie jest domyślnie przyznana rolom Agent Orchestratora. Administrator musi jawnie nadać ją roli/użytkownikowi uruchamiającemu discovery.
- Błędy kosztu, braku konfiguracji i platform block wracają do agenta jako strukturalna diagnostyka. Nie dodajemy osobnych toastów ani ekranów runu.

## Configuration

| Zmienna | Domyślnie | Znaczenie |
| --- | ---: | --- |
| `OM_INTEGRATION_APIFY_API_TOKEN` | brak | Sekret używany wyłącznie przez provider-owned preset/CLI. |
| `OM_INTEGRATION_APIFY_ENABLED` | `false` | Pozwala presetowi jawnie aktywować integrację po zapisaniu credentials. |
| `OM_INTEGRATION_APIFY_MAX_CHARGE_USD` | `0.25` | Limit ryzyka na run, clamp `0.01–0.50`. |
| `OM_INTEGRATION_APIFY_TIMEOUT_SECONDS` | `120` | Deadline runu, clamp `30–180`. |
| `OM_INTEGRATION_APIFY_MAX_ITEMS` | `25` | Globalny ceiling; profile/page/place nadal mają 1. |
| `OM_INTEGRATION_APIFY_MAX_CONCURRENCY` | `4` | Ceiling globalny per proces, max 8. |
| `OM_INTEGRATION_APIFY_MAX_CONCURRENCY_PER_TENANT` | `2` | Ceiling per tenant, max 4. |
| `OM_INTEGRATION_APIFY_MAX_CALLS_PER_RUN` | `4` | Wywołania w jednym AgentRun, max 8. |
| `OM_INTEGRATION_APIFY_RUN_BUDGET_USD` | `0.50` | Budżet ryzyka AgentRun, max 1.00. |
| `OM_INTEGRATION_APIFY_TENANT_CALLS_PER_HOUR` | `30` | Sliding/fixed window przez `rateLimiterService`, max 120. |
| `OM_INTEGRATION_APIFY_TENANT_BUDGET_USD_PER_HOUR` | `5.00` | Budżet ryzyka na tenant i godzinę, max 20.00. |

Nieprawidłowa wartość konfiguracyjna nie jest cicho zastępowana luźniejszym limitem. Provider odmawia startu płatnego runu i raportuje sanitizowany błąd konfiguracji.

## Access Control

- Nowa funkcja `integration_apify.research` zależy od `agent_orchestrator.agents.run`.
- Funkcja jest default-off: nie trafia do standardowych grantów wąskich ról agentowych. Administrator z wildcard zachowuje istniejącą semantykę wildcard ACL.
- Wszystkie cztery tools wymagają tej samej funkcji; rozdzielanie platform nie daje w MVP wystarczającej korzyści względem złożoności konfiguracji.
- Standardowe funkcje Marketplace/integrations kontrolują view/configure/test credentials. `integration_apify.research` nie daje prawa do odczytu lub zmiany tokenu.
- MCP bridge ponownie sprawdza `requiredFeatures` przy każdym wywołaniu, również gdy tool był wcześniej widoczny w sesji.

## 📝 Edge Cases & Failure Scenarios

| Sytuacja | Zachowanie |
| --- | --- |
| Brak tokenu dla org+tenant | `error/not_configured`; zero połączeń do Apify. |
| Brak `sessionId`, `AgentRun` lub mismatch scope | `error/run_context_missing`; zero kosztu i alert security telemetry przy mismatch. |
| Brak ACL | MCP odmawia przed handlerem; zero kosztu. |
| Budżet lub quota wyczerpane | `error/budget_exceeded`; brak odczytu tokenu i brak runu. |
| Brak lease współbieżności | `error/concurrency_limited`; agent nie retry'uje automatycznie. |
| Limiter wyłączony/degraded | Fail closed; `budget_exceeded` z wewnętrznym reason w telemetry. |
| Nieprawidłowy URL/target | `error/invalid_target` przed rezerwacją kosztu. |
| Prywatny/personalny target poza zakresem | `error/unsupported_public_scope`, `data: null`; minimalnie odczytane metadata są odrzucane i nie trafiają do trace. |
| Apify 401 | `error/upstream_unauthorized`; health staje się unhealthy. |
| Apify 403 | `error/upstream_forbidden`; bez retry. |
| Apify 429 | `error/upstream_rate_limited`; bez automatycznego nowego runu. |
| Niejednoznaczny błąd startu | `error/upstream_unavailable`; nigdy nie startuje drugiego runu. |
| Timeout | Best-effort abort znanego runu, `error/timeout`, bez restartu. |
| Run kończy się `FAILED`/`ABORTED`/`TIMED-OUT` | Sanitizowany `upstream_unavailable` albo `timeout`; status runu w telemetry. |
| Platform block/CAPTCHA | `error` lub `partial/platform_blocked`; brak obejścia zabezpieczeń. |
| Pusty dataset | `no_data/no_data`, a nie pusty kompletny rekord. |
| Więcej niż jeden rekord dla single-target toola | Pierwszy jednoznacznie pasujący rekord; `partial_dataset`; brak scalań z innych targetów. |
| Brak oczekiwanego pola | `null` + `unavailableFields`; nie podstawia zera. |
| Nieoczekiwany typ/shape | `partial/schema_changed` dla izolowanego pola lub `error/schema_changed`, gdy tożsamość rekordu nie jest pewna. |
| Wynik >64 KiB | Deterministyczne obcięcie pól tekstowych/listy, `partial/output_truncated`. |
| Cleanup storage nieudany | Wynik zachowany, `warning/cleanup_failed`, integration log + `reportError`. |
| Cofnięcie ACL podczas runu | Bieżące upstream call nie jest ponawiane; wynik jest odrzucany przed zwrotem, jeśli bridge wspiera final recheck. Nowe wywołania są blokowane. |

## Observability

Provider emituje strukturalne metryki i logi bez raw input/output:

- liczba wywołań według `toolId`, statusu i kodu diagnostycznego;
- latencja startu, czas runu, polling i normalizacja;
- zarezerwowany koszt ryzyka w milli-USD, katalogowy model ceny oraz raportowany przez Apify koszt, jeśli jest dostępny;
- liczba elementów przed i po normalizacji oraz rozmiar wyniku;
- quota/budget/concurrency rejects;
- schema drift, platform blocks, timeouts i cleanup failures;
- `organizationId`, `tenantId`, `agentRunId` oraz `actorRunId` jako scope/audit IDs.

Logi używają `createLogger`/child logger. Nie zawierają tokenu, pełnego raw URL z query, username autora opinii, tekstu opinii, biography, description ani raw payloadu. Każdy catch, który zapisuje błąd i zwraca fallback/diagnostykę, również woła `reportError` lub `integrationLogService` na poziomie error ze stabilnym `module.reason`.

## Security, Privacy and Compliance

- Token jest sekretem tenant-wide, szyfrowanym przez istniejący credentials service, pobieranym dopiero po walidacji celu, ACL, run context i budgetu.
- Provider nie ujawnia tokenu modelowi i nie zapisuje go w prompt, trace, logu, error cause ani health details.
- Wejściowe URL są canonicalizowane; dozwolone są wyłącznie HTTPS i jawne hosty platform. Adapter nie wykonuje dowolnego fetch i nie przyjmuje webhook URL, proxy URL ani callback URL, co usuwa powierzchnię SSRF.
- Provider nie przyjmuje cookies, credentials platform, residential proxy selection ani opcji obchodzenia zabezpieczeń.
- Google Reviews wymusza `personalData: false`; normalizer usuwa wszelkie identyfikatory reviewerów nawet wtedy, gdy upstream je zwróci.
- Publiczność danych nie jest sama w sobie podstawą prawną. Wdrożenie UE/EOG musi udokumentować cel, minimalizację, podstawę prawną, notice/DPA i okres retencji.
- DSAR/usunięcie obejmuje istniejące dane AgentRun/trace i, gdy cleanup się nie powiódł, operacyjną procedurę usunięcia danych z workspace Apify po `actorRunId`.
- Operator odpowiada za zgodność z regulaminami Apify i platform źródłowych. Provider jest kontrolą techniczną, nie udziela prawnego upoważnienia do scrapingu.

## Testing Strategy

### Unit

- walidatory każdego wejścia, canonicalizacja URL i odrzucenie niedozwolonych targetów;
- katalog Actorów: brak ruchomych tagów, dokładny build, zamknięte input factories, ceilings i unikalne przypisanie toola;
- normalizatory na zapisanych, zanonimizowanych fixtures: complete, partial, no data, zero obecne, pole brakujące, zły typ i drift;
- redakcja reviewer identity i limity tekstu/rozmiaru;
- mapowanie statusów i błędów Apify na stabilne diagnostics;
- config clamps i fail-closed parsing;
- rezerwacja run/tenant cost, call limits, concurrency lease, TTL i release w `finally`;
- brak retry dla startu i ograniczony retry wyłącznie dla GET znanego runu;
- serializacja wyniku bez `undefined`, sekretów i raw payloadu.

### Integration

- tenant A nigdy nie odczytuje credentials tenanta B; test obejmuje również różne organization IDs;
- provider rozwiązuje wyłącznie tenant-wide credential (`userId: null`);
- `requiredFeatures` ukrywa/odrzuca tools bez `integration_apify.research`, w tym wildcard matching;
- brak aktywnego `AgentRun` i mismatch session scope zatrzymują wywołanie przed klientem Apify;
- health check: success, brak tokenu, 401/403, 429/500, timeout, brak poprawnej odpowiedzi użytkownika oraz gwarancja braku wywołań Actor/build;
- mocked Apify transport potwierdza exact build, bounded input, `maxItems`, deadline i brak drugiego POST;
- cleanup korzysta tylko z storage IDs danego runu i nie wpływa na inny run;
- auto-discovery po `yarn generate`, MCP listing i jedno wywołanie przez Agent Orchestrator smoke fixture;
- standardowy Marketplace flow: utworzenie credentials, health, disable oraz cleanup fixture w `finally`.

Testy integracyjne są samowystarczalne i nie zależą od seeded/demo data. CI nie wymaga prawdziwego tokenu ani płatnego runu. Oddzielny, jawnie uruchamiany canary z sekretem testowym sprawdza każdy proponowany update buildu na minimalnym publicznym fixture i zapisuje jedynie zanonimizowany shape/hash, koszt i status.

### Validation gate

Najmniejszy wymagany gate dla implementacji:

```bash
yarn generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
```

Jeśli PR dotknie renderowanego UI lub istniejącego Marketplace UI okaże się niewystarczające, dochodzi `yarn build:app` i browser QA zgodnie z polityką repozytorium.

## 📝 Risks & Impact Review

### Risk: podwójny koszt po retry

- **Severity:** High
- **Likelihood:** Medium bez kontroli, Low po wdrożeniu
- **Affected area:** finanse tenanta, Apify usage, AgentRun
- **Mitigation:** `maxRetries: 0` dla startu, brak automatycznego ponowienia, exact `actorRunId`, deadline i konserwatywna rezerwacja przed credentials.
- **Residual risk:** timeout sieci po przyjęciu POST może pozostawić nieznany płatny run; provider zgłasza błąd i wymaga manualnej inspekcji zamiast restartu.

### Risk: wzrost ceny lub zmiana modelu rozliczenia Actora

- **Severity:** High
- **Likelihood:** Medium
- **Affected area:** cost ceilings, dostępność tools
- **Mitigation:** katalogowy model ceny, `maxItems`, `maxTotalChargeUsd` dla PPE, kontrola katalogu przy aktualizacji, PR i canary dla zmiany buildu. Health check sprawdza wyłącznie token i łączność.
- **Residual risk:** zewnętrzny cennik może zmienić się pomiędzy kontrolami; lokalny budget jest limitem ryzyka, nie gwarancją rozliczeniową Apify.

### Risk: schema drift i błędna interpretacja danych

- **Severity:** High
- **Likelihood:** Medium
- **Affected area:** wyniki discovery i decyzje agenta
- **Mitigation:** pinned build, contract fixtures, ścisłe runtime schemas, `null + reason`, `schema_changed`, brak heurystycznego wypełniania.
- **Residual risk:** Actor może zmienić dane źródłowe bez zmiany buildu; krytyczna niejednoznaczność blokuje wynik.

### Risk: ujawnienie sekretu lub danych osobowych

- **Severity:** Critical
- **Likelihood:** Low
- **Affected area:** tenant credentials, prywatność, compliance
- **Mitigation:** scoped encrypted credentials, late resolution, log redaction, bounded normalizers, `personalData: false`, usunięcie reviewer identity, tests for secret absence.
- **Residual risk:** treść opinii może zawierać incydentalne dane osobowe wpisane w tekst; jest ograniczana, podlega retencji AgentRun i wymaga podstawy prawnej operatora.

### Risk: cross-tenant access

- **Severity:** Critical
- **Likelihood:** Low
- **Affected area:** cała integracja
- **Mitigation:** każdy odczyt credentials i runu wymaga jednocześnie `organizationId` i `tenantId`, brak fallbacku po samym tenant ID, testy negatywne.
- **Residual risk:** błąd w upstream shared services; implementacja nie może omijać ich kontraktów ani tworzyć własnego storage.

### Risk: długie synchroniczne runy blokują tool loop

- **Severity:** Medium
- **Likelihood:** Medium
- **Affected area:** latency i UX agenta
- **Mitigation:** małe targety, timeout 120 s/ceiling 180 s, maxItems, bounded polling, concurrency leases.
- **Residual risk:** wolny upstream może zużyć większość czasu jednej iteracji; dłuższe use cases wymagają osobnej architektury workerowej.

### Risk: dane pozostają w Apify po cleanup failure

- **Severity:** High
- **Likelihood:** Low
- **Affected area:** zewnętrzna retencja i DSAR
- **Mitigation:** best-effort deletion wszystkich storage IDs, alert z `actorRunId`, DPA i procedura operacyjna workspace.
- **Residual risk:** metadata runu i dane objęte polityką Apify mogą istnieć do czasu manualnego lub automatycznego usunięcia.

### Risk: narzędzie read-only generuje zewnętrzny skutek finansowy

- **Severity:** High
- **Likelihood:** Certain
- **Affected area:** ACL, audyt i oczekiwania użytkownika
- **Mitigation:** osobna default-off funkcja egress, aktywny AgentRun, quota/cost reservation, jednoznaczne opisy tools i telemetry.
- **Residual risk:** `isMutation: false` opisuje brak mutacji domeny, a nie brak kosztu; dokumentacja i UI Marketplace muszą to jasno komunikować.

## 📋 Phasing

### Phase 1 — Provider shell, Marketplace i credentials

- utworzyć workspace package i moduł `integration_apify`;
- dodać manifest integracji, credentials definition, i18n, setup/DI i ACL;
- dodać provider-owned env preset oraz CLI `configure-from-env`;
- dodać prawdziwy, niepłatny health check;
- dodać testy scope, secrets i konfiguracji.

**Exit criteria:** integracja jest wykrywana, konfigurowalna i testowalna w Marketplace, ale żaden płatny tool nie jest jeszcze opublikowany.

### Phase 2 — Runtime safety foundation

- dodać adapter oficjalnego klienta z kontrolą retry;
- zapisać katalog Actorów z dokładnymi buildami, ceną i schema/fixture hashes;
- wdrożyć `apifyQuotaService`, AgentRun resolution, deadline/polling i cleanup;
- dodać wspólną kopertę wyniku, diagnostics, redakcję i telemetry;
- zatwierdzić buildy przez jawny live canary.

**Exit criteria:** fundament potrafi bezpiecznie wykonać mocked run end-to-end i fail closed dla każdego brakującego guardu; narzędzia nadal nie są auto-discovered.

### Phase 3 — Instagram i Facebook

- wdrożyć dwa walidatory, input factories i normalizatory;
- zarejestrować dwa tools social profile/page;
- dodać fixtures complete/partial/private/no-data/schema-drift;
- zweryfikować ACL, MCP discovery i brak sekretów.

**Exit criteria:** oba tools działają przez MCP na mocked upstream i minimalnym canary, z limitem jednego rekordu.

### Phase 4 — Google Maps place i reviews

- wdrożyć walidację Place URL/ID i oba normalizatory;
- twardo wymusić `personalData: false` i usuwanie reviewer identity;
- dodać limity próbki, tekstu i całego wyniku;
- zarejestrować dwa tools Maps i rozszerzyć canary/fixtures.

**Exit criteria:** wszystkie cztery tools spełniają kontrakty, cost ceilings i privacy tests.

### Phase 5 — Discovery integration verification i dokumentacja

- uruchomić `yarn generate` i sprawdzić auto-discovery;
- dodać nierejestrowany, test-only Agent Orchestrator smoke fixture referencjonujący cztery package tools, bez produkcyjnego promptu i zachowania agenta;
- wykonać Marketplace integration path i negatywne testy tenant/ACL/run context;
- udokumentować konfigurację, koszty, privacy, build update runbook i operacyjny cleanup;
- uruchomić pełny validation gate.

**Exit criteria:** pakiet jest niezależnie instalowalny i konfigurowalny, a jego płatne tools działają wyłącznie w runtime Agent Orchestratora oraz są gotowe do użycia przez osobno specyfikowanego agenta discovery.

### Follow-up — Full client discovery agent

Osobna specyfikacja opisze kolejność źródeł, budżet całego discovery, syntezę dowodów, provenance, prompt/guardrails i ewentualne rozszerzenie `portfolio_reader_o1`. Follow-up może referencjonować wyłącznie publiczne tool IDs z tej specyfikacji; nie może importować provider internals.

## 📋 Implementation Plan

### File manifest

Przewidywane pliki pakietu:

```text
packages/integration-apify/
  package.json
  tsconfig.json
  src/
    index.ts
    modules/integration_apify/
      index.ts
      integration.ts
      credentials.ts
      setup.ts
      acl.ts
      ai-tools.ts
      cli.ts
      preset.ts
      lib/
        client.ts
        actor-catalog.ts
        config.ts
        diagnostics.ts
        execute-actor.ts
        quota.ts
        result.ts
        targets.ts
        cleanup.ts
        normalizers/
          instagram-profile.ts
          facebook-page.ts
          google-maps-place.ts
          google-maps-reviews.ts
      i18n/
        en.json
        pl.json
      __tests__/
        actor-catalog.test.ts
        config.test.ts
        credentials.test.ts
        health.test.ts
        quota.test.ts
        execute-actor.test.ts
        ai-tools.test.ts
        normalizers.test.ts
      __fixtures__/
        ...sanitized-json
      __integration__/
        apify-provider.test.ts
```

Dokładne nazwy plików mogą zostać dopasowane do generatora i konwencji najbliższego istniejącego providera, ale rozdział odpowiedzialności, publiczne IDs i kontrakty tej specyfikacji są wiążące.

### Step-by-step

1. Porównać najbliższy provider integration package i potwierdzić wymagane exports/workspace wiring bez zmian w core.
2. Dodać pakiet, manifest, credentials, setup/DI, ACL, env preset, CLI, i18n i health check.
3. Dodać `apify-client` jako produkcyjną zależność wyłącznie pakietu; nie eksportować jego typów z publicznego API OM.
4. Zweryfikować w Apify cztery aktualne buildy, model ceny i input schema; zapisać numery/hashes/fixtures w katalogu i uruchomić canary.
5. Zbudować fail-closed config, AgentRun resolver, quota service, credential resolution, execute/poll/abort/cleanup pipeline i common result envelope.
6. Dodać kolejno normalizatory i tools: Instagram, Facebook, Maps place, Maps reviews.
7. Dodać unit i integration tests z mocked transport oraz nierejestrowany, test-only smoke fixture Agent Orchestratora bez produkcyjnego promptu.
8. Uruchomić `yarn generate`, sprawdzić wygenerowane rejestry bez ręcznej edycji i wykonać validation gate.
9. Udokumentować operator setup, default-off grant, koszty, retencję, live canary i build update/rollback runbook.

## Migration & Backward Compatibility

- Zmiana jest addytywna: nowy pakiet, moduł, integracja, ACL i cztery tool IDs. Nie zmienia istniejących encji, route, eventów ani kontraktów O1.
- Od pierwszego wydania `integration_apify`, `integration_apify.research` i cztery tool IDs są zamrożonymi identyfikatorami kontraktowymi. Nie wolno ich usuwać ani zmieniać semantyki bez protokołu deprecacji z `BACKWARD_COMPATIBILITY.md`.
- Pola wyniku mogą być rozszerzane addytywnie jako optional/nullable. Zawężenie dozwolonych inputów, zmiana jednostek metryk lub zmiana znaczenia `null` jest breaking change.
- Build Actora jest prywatnym szczegółem wykonawczym i może być aktualizowany po contract tests/canary, o ile publiczny kontrakt i semantyka pozostają zgodne.
- Brak migracji bazy. `yarn generate` aktualizuje wyłącznie przewidziane auto-discovered registries; generated files nie są edytowane ręcznie.
- Rollback operacyjny: cofnąć grant `integration_apify.research`, wyłączyć integrację i w razie potrzeby użyć istniejącego override narzędzi. Rollback nie usuwa publicznych IDs ani historycznych `actorRunId`.
- Usunięcie pakietu po publikacji wymaga co najmniej jednego minor release z `@deprecated`, mostem/aliasem tam, gdzie możliwe, wpisem w `UPGRADE_NOTES.md` i specyfikacją migracji.

## Final Compliance Report

- [x] Spec ma jasno rozdzielony provider danych od przyszłego agenta pełnego discovery.
- [x] Brak generycznego Actor runnera, arbitrary input, Apify MCP i provider logic w core.
- [x] Wszystkie wywołania są read-only dla domeny, ale traktowane jako płatny egress z default-off ACL.
- [x] Credentials są tenant-wide, szyfrowane i rozwiązywane z pełnym organization+tenant scope.
- [x] Katalog wymaga dokładnych buildów, contract fixtures i jawnego update workflow.
- [x] Koszt, liczba elementów, czas, współbieżność, AgentRun i tenant window mają fail-closed limity.
- [x] Retry nie może utworzyć drugiego płatnego runu.
- [x] Brakujące dane są `null` z przyczyną; zero nie zastępuje braku.
- [x] Raw dataset nie jest utrwalany w Open Mercato, a external storage ma cleanup i procedurę awaryjną.
- [x] Google Reviews nie zwraca tożsamości reviewerów i wymusza `personalData: false`.
- [x] Brak zmian DB i publicznego HTTP API; integracja korzysta z obecnych Marketplace/MCP contracts.
- [x] Plan obejmuje unit, integration, tenant isolation, ACL, MCP discovery, Marketplace i jawny live canary poza CI.
- [x] Publiczne tool/ACL/integration IDs są objęte polityką backward compatibility.
- [x] Spec zawiera rollback, observability, privacy/compliance i ryzyka rezydualne.
- [x] Publiczna instalacja providera jest odróżniona od twardej zależności wykonawczej jego płatnych tools od Agent Orchestratora.

## Changelog

### 2026-09-19 — Hackathon connection check simplification

- Na wyraźne polecenie użytkownika usunięto audyt czterech Actorów z testu połączenia. Jedynym zapytaniem jest `user().get()`; zdrowy status nie jest już certyfikacją katalogu/cennika.
- Cofnięto zwiększenie limitu odpowiedzi do 2 MiB, zachowano 256 KiB, dodano test braku wywołań Actor/build. Nie zmieniono ACL, tenant scoping, przypiętych buildów ani limitów płatnego wykonania.

### 2026-09-19 — Initial skeleton

- Zdefiniowano cel, scope i granice architektoniczne.
- Zebrano pytania o klienta, katalog, Actors, limity, wykonanie, dystrybucję, retencję, O1, dane osobowe, prawo i ACL.

### 2026-09-19 — Decisions and full draft

- Użytkownik delegował decyzje projektowe z kontekstem pełnego etapu discovery klienta.
- Wybrano oficjalny klient za adapterem, direct Actors z exact build pinning, synchroniczne bounded runs i publiczny provider package.
- Rozdzielono provider od O1/docelowego agenta discovery.
- Dodano stabilne kontrakty czterech tools, budżety, quota/concurrency, retencję, privacy, diagnostics, testy i plan fazowy.
- Zweryfikowano założenia w oficjalnej dokumentacji Apify i istniejących kontraktach repozytorium.

### 2026-09-19 — Scope and cohesion review

- Doprecyzowano, że pakiet jest publicznie instalowalny, ale płatne tools mają twardą zależność wykonawczą od aktywnego AgentRun.
- Ujednolicono zakaz prywatnych i niepotwierdzonych profili osobistych w scope, kontrakcie Instagram i failure matrix.
- Ograniczono Agent Orchestrator smoke do nierejestrowanego fixture testowego i pozostawiono agenta discovery wyłącznie jako follow-up.
- Dodano operacyjne powierzchnie MVP i wyjaśniono, że `isMutation: false` nie oznacza braku kosztu ani efektów po stronie Apify.
- Implementacja przypięła rzeczywiste kontrakty output Actorów; bieżący Instagram pin potwierdza tylko konta biznesowe, więc creator bez jednoznacznego sygnału nadal fail-closed.
