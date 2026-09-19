# Photographer hidden potential implementation

Source: [specification](../../specs/enterprise/2026-09-19-photographer-hidden-potential-mvp.md).

## Governing decision — 2026-09-19

The user requires no Open Mercato framework changes for the hackathon. All previous task edits under packages were withdrawn. The current design uses only the photographers application module and existing extension points. This replaces the former Caseload-host exception and proposed custom workflow activity prerequisites. The original business scope remains unchanged.

## Previous increment — foundation

1. Replace custom activities with built-in EXECUTE_FUNCTION transitions and WAIT_FOR_SIGNAL steps. Prove two parallel lanes, matching operation receipts, joining and a separate review wait.
2. Store original encrypted materials in a technical photographers table, independent of editable CRM interactions. Generate a scoped migration; apply it to the developer database only after explicit authorization (subsequently received and executed on 2026-09-19).
3. Show full facts and messages through the existing backend:layout:top widget spot. Keep native Caseload controls. Require fresh server evidence that the same operator received the exact proposal/material version before canonical disposition.
4. Validate using isolated synthetic fixtures, a disposable database and real queues. Keep production research disabled until phase 1 passes.

## Implemented boundaries

- Contracts, versioned rules, custom fields, ACL and recoverable pipeline installation. Repeated setup repairs missing records without duplicate stages and invalidates changed field caches.
- Immutable material command and scoped no-store GET; encryption, canonical checksum, 128 KiB bound and idempotency checks. PhotographerEvaluationMaterial is technical storage, not a second business lifecycle. No public update/delete or destructive undo. Existing CRM interaction commands do not own these rows.
- Generated Migration20260919114825_photographers.ts and module snapshot; a second generation reports no changes. After explicit user authorization, Migration20260919114825 was applied to the developer database on 2026-09-19. Exact columns, indexes and migration history were verified; see [local-migration.json](evidence/local-migration.json).
- Test-only synthetic workflow, DI dispatch and discovered queue worker. Dispatch enqueues references, returns an operation receipt and enters a standard wait. Callback checks current scope, actor permissions, material ownership, receipt and latest active wait inside a scoped workflow lock. The signal transaction defers engine continuation through a child DI scope; the real engine resumes after commit, avoiding failure persistence waiting on its own outer lock. A repeated job can recover this committed continuation without resending the signal.
- The review worker remains paused. An explicit integration-only engine driver can simulate the review signal, but this is not proof of a human decision or canonical proposal disposition.
- Existing backend layout widget shows complete facts/message on the proposal detail route. Proposal/material reads are validated; stale navigation results are ignored. Switching organization/tenant remounts the view immediately and clears the prior scope’s materials. An AccessLogService record binds operator, proposal version, envelope and material digests, with a five-minute expiry.
- Canonical disposition interceptor supports the message-review contract, preserves native rejection and unrelated agents, rejects auto-approval and blocks identity/evaluation approval until their contracts are implemented. Evidence means the server delivered the material, not that a human read it.

## Remaining phase 1 work

- Registration-to-CRM preparation, eligible process start and recovery.
- Production worker/adapters and durable application callback for canonical proposal decisions. Native proposal signals cannot safely identify later wait attempts and may carry the proposal envelope; production needs unique refs-only application signals.
- Native rerun-from-step creates a new wait attempt while retaining context. The current synthetic worker checks the latest active wait plus operation receipt, but does not bind that receipt to the original attempt. Production must bind attempts or guard rerun through application extension points; delayed callbacks after rerun are not proven safe. The native rerun route calls executeStep directly (no command/before interceptor); the existing app API route-override mechanism can wrap POST /api/workflows/instances/[id]/rerun-step for this workflow, preserving other workflows. No override is activated in this increment.
- Recovery after queue retries exhaust. The local queue may discard such a job; current test-only receipt checks do not provide an outbox or recovery scheduler.
- Message revision/waiver endpoints and corresponding UI; identity/evaluation decision contracts.
- Complete restart/privacy proof and full validation gate. Live DB/local/async queue proof and browser material-preview regression passed; production callback coverage remains pending.

## Validation evidence for current design

Runner: local; default and fullapp compose probes found no running app container. Existing developer backing services are left intact.

- Real workflow engine function tests plus test runtime checks: 14 tests across two suites passed; persistence/DI dependencies are doubled, so these are not live database integration results.
- Current photographers focused unit run: 15 suites, 128 tests passed, including widget rendering, navigation/scope changes, event refresh and queue-failure continuation regression.
- Proposal access/route focused tests: 25 passed.
- Generation after new DI/workflow/worker/widget conventions: passed.
- Focused module ESLint: passed. App typecheck: passed after correcting synthetic definition types. Translation sync: passed across all five locales. Translation usage passed with existing unused-key advisory output. Client-boundary check completed in report mode; existing client page roots remain, so this is not a clean strict-boundary result.
- Independent code review found and fixed stale scope display and a transaction/executor failure deadlock; no further high-impact finding in the bounded storage/runtime review.
- Historical generic Caseload-host test results are excluded: that code was withdrawn.
- Production app compilation passed during disposable environment preparation. Initial startup was blocked by a different process owning the original application directory; testing moved to a separate temporary source snapshot without stopping that process. The earlier attempts regenerated the original app build output before the CLI detected the lock; the developer database was not migrated. Later runs use isolated build output and cloned dependencies.
- Exploratory real command/HTTP material proof passed on disposable PostgreSQL: ciphertext, idempotent replay/conflicting replay, same-UUID CRM projection edits/deletion, owner deletion blocking read, and real undo restoring access to the unchanged original. Sanitized evidence: [material-live-probe.json](evidence/material-live-probe.json). The supported CLI regression result is recorded below.
- Supported CLI integration tests TC-001 and TC-016 passed: 2/2, no retries/skips. Evidence: [integration-001-016.json](evidence/integration-001-016.json).
- Browser exploration confirmed full message/rationale rendering, canonical approval rejected before access evidence (409), no-store materials read, and native rejection (200). [Screenshot](evidence/TC-PHOTOGRAPHERS-021-materials.png). TC-021 native browser regression passed: 1/1, no retries/skips. Evidence: [TC-PHOTOGRAPHERS-021-results.json](evidence/TC-PHOTOGRAPHERS-021-results.json).
- Supported CLI TC-022 passed: 3/3 on the real database with local queue, dedicated disposable Redis async queue and forced review-dispatch outage; no retries/skips. Evidence: [integration-022.json](evidence/integration-022.json). Initial cleanup failure is preserved separately. The owned Redis container was removed. Production limits: [synthetic-workflow-limitations.json](evidence/synthetic-workflow-limitations.json).
- Final focused total: 128 unit tests and 6 real integration cases passed. TC-021 initially was not discovered because a standalone-app environment flag excluded the conditional agent module; standard monorepo discovery resolved this without source changes. Full implementation gate and live demo remain pending. TC-022 is the new synthetic workflow case; the existing TC-017 correction/evaluation requirement remains unchanged.

## Progress

The disposable application, five owned PostgreSQL 16 containers, dedicated Redis, owned test reaper and temporary source copy have been removed. The original application process is still running and its login page returns HTTP 200; the developer PostgreSQL 17 service remains running. Evidence: [environment-cleanup.json](evidence/environment-cleanup.json). Final diff whitespace check passed and packages has no tracked or untracked task changes.

- [ ] Phase 1 — execution integration and data protection
- [ ] Phase 2 — discovery and research
- [ ] Phase 3 — scoring and decisions
- [ ] Phase 4 — message, batch and demonstration

## Local migration — 2026-09-19

At the user’s explicit request, the original photographers migration was applied through MikroORM with an explicit migrationsList matching the unsuffixed names already in the database history. Default file discovery incorrectly considered the older suffixed filenames pending and its attempted CREATE failed without changes. The successful targeted migration created only photographers_evaluation_materials and its indexes. Framework files and existing migration history were not modified. This naming mismatch in the default migration command remains; future default runs may attempt the older migrations again.


## Visible scenario increment — 2026-09-19

The user authorized connecting the prepared components into one scenario available in the application. This increment adds `/backend/photographers/demo` under Photographers. Its explicit fictional-data label distinguishes deterministic fixture adapters from future live research. It creates a registration and linked CRM person/deal, starts a native ProcessInstance/WorkflowInstance, records real agent runs and a review proposal, and uses native Caseload approval/rejection. Approval records the exact approved draft and moves the deal to contacted without sending anything; rejection records the decision and moves it to observed.

The request ID is stable across HTTP retries. A tenant/organization/actor-bound ModuleConfig receipt stores only creation references and phase intent; it is a technical recovery receipt, not another business lifecycle. The original registration fields remain immutable. Startup and callback recovery use the existing scheduler and queue. Callbacks bind to the original step attempt; native rerun invalidates this bounded scenario instead of allowing an old proposal to complete a new attempt. Ambiguous commit-before-audit gaps fail closed rather than recreate a CRM record or overwrite later edits.

- [x] Add the server page and small client scenario component, guarded start/reconcile routes and scoped read route.
- [x] Implement recoverable fixture preparation through application and CRM commands.
- [x] Implement a registered native workflow with two fixture lanes and review wait.
- [x] Implement proposal publication, audited CRM decision effects and conservative undo; live verification remains below.
- [ ] Validate native Caseload approval/rejection, recovery and scoping on a disposable database and browser.
- [x] Run focused checks and independent review, record full-gate limitations, and rebuild/configure/restart the developer application.
- [ ] User manual acceptance: the earlier user run failed after both decisions. The later decision-completion fix below resolves the technical blocker and verifies both paths; a new manual confirmation by the user is still separate from automated proof.

User testing preference: the user offered to perform the scenario acceptance check. Finish the concrete startup defect found during the live probe, verify the minimal start-to-review path, and expose the page in the developer application. Leave the full manual approval/rejection acceptance exercise to the user rather than extending the automated test matrix before handoff.

Runner: local. Development and integration used an isolated snapshot while the original application remained running. Final deployment used a controlled stop and the standard full build, then photographers-only default setup and restart on port 3001. No additional database migration was applied. Full live research, identity review, editing/waivers and batch operation remain tracked in the specification.

Current combined checks: 25 photographers unit suites / 212 tests pass. App typecheck and root lint pass (lint retains ten existing warnings outside this module). Translation synchronization passes across all five locales. The isolated preparation gate passes package build, generation and package rebuild; the disposable production app builds and starts successfully.

The first real Start request exposed an advisory-lock transaction leaking into native child writes while fresh forks read outside that transaction. The shared application-only lock now uses an isolated explicit transaction for the advisory lock; child commands retain their own commit boundaries. Preparation, runtime and proposal effects use this helper. Regressions cover transaction isolation, rollback and preparation rereads. Preparation invalidates cached recovery receipts before the locked read and after completion/failure.

The next browser probe confirmed Start returns 202 and creates the scoped CRM/process records. TC-023 exposed a click before client hydration; the Start button now remains disabled until the client attaches. Background progression then exposed duplicate command registration, reproduced through the discovered worker: it imported a raw-data helper from a module with registration side effects. The helper and entity identifier now live in a pure library file, with the existing command exports preserved. Raw-data/preparation checks pass (61 tests, including the new import-side-effect regression), and the client checks pass (2 tests). Browser TC-023 has not yet passed and is not reported as successful. Stopping the owned ephemeral application also removed its owned database, so the planned retained-database worker probe could not proceed. Per the user's manual-testing preference, the developer app has been rebuilt and the full progression after this final fix is left explicitly for manual verification. The owned temporary snapshot, test processes and test database have been removed; the developer application and database remain running.

The full repository gate is not green. Root typecheck, repeated after generation in the isolated snapshot, fails in core modules whose entity IDs are absent from the app's enabled-module registry (including resources and wms). The full unit run passes all 791 application tests available at that run, but the core ACL catalog test requires app-specific photographer labels in the core auth locale; the same five missing keys exist at HEAD. Runtime labels are supplied in this app module's own locale files, preserving the no-framework-change constraint. A README setup instruction fixed the documentation test (4/4 pass on recheck); the metadata icon check passes after using existing registered icons. Later preparation identity, historical-material and transaction-isolation regressions are included in the 212-test module total. These checks do not substitute for the pending live end-to-end scenario proof.

Developer deployment: the full standard build passed, including the production application build. `seed:defaults --module photographers` installed the missing configuration in the three active organizations; read-only checks confirmed the pipeline and all four referenced stages in each. The supported encryption-map helper inserted only absent maps required by this demo, preserving all existing mappings; boolean probes passed for every required field in all three organizations. A controlled restart refreshed the running application's mapping cache. The new application listens on port 3001, the login page returns 200, and an unauthenticated request to the protected demo route redirects to session refresh. The original environment-file hash and PostgreSQL service are unchanged. No synthetic scenario was created in the developer database on the user's behalf. [Deployment evidence](evidence/demo-deployment.json). [TC-023 evidence and remaining manual acceptance](evidence/integration-023-incomplete.json).

## Decision-completion diagnosis and fix — 2026-09-19

The user authorized diagnosis and repair of both demo dispositions, superseding the earlier request to leave final acceptance manual. Scope remains the app-local photographers module; no framework edits, migrations, environment reset, stage renaming or live AI/message delivery.

The initial read-only database/browser investigation found four existing decisions (three approvals, one rejection), all with workflow PAUSED at wait_review and process running. All deals were still Ready for contact and had zero interactions. The worker failed before CRM effects because a richer disposition input was spread into an AgentProposal query, producing the nonexistent AgentProposal.proposalId predicate. The status read also failed on this query. The recovery scheduler independently failed strict job validation on its injected transport metadata. See [initial evidence](evidence/decision-diagnosis-before.json).

Fixes and subsequent findings:

- Project the proposal lookup scope explicitly to tenantId and organizationId; preserve ID, source and deleted filters.
- Validate and remove scheduler transport metadata, checking nested scope agrees with the domain scope; retain rejection of unknown domain fields.
- Read the completed review step inside the signal transaction during inline finalization. Real signal-handler/function-dispatch regressions first reproduced invalid_attempt with an isolated read double; completed-state and attempt checks remain intact.
- After the first rebuild, existing decisions progressed to the intended stages. Their phase receipts were present, but default audit encryption includes command_id; a plaintext WHERE predicate could not find them. Query only scoped resource references, then filter decrypted command IDs for both decision and publication checkpoints. No unaudited write is adopted and no later version conflict is bypassed.
- TC-023 also reproduced initial organization synchronization remounting the demo during its start request: GET returned404 before POST202, leaving no polling state. Ignore only the initial unknown-scope synchronization; real scope changes still clear prior data.

Runner: local (both configured compose probes found no running app container). Browser/test runner attached to the user-specified app at localhost:3001, using a dedicated temporary organization and test user with cleanup. Tests retain the real worker, PostgreSQL, canonical Caseload disposition, CRM commands and encrypted audit configuration (including command_id). No test environment/database reset or migration was run.

- [x] Reproduce the reported failure and record actual proposal, workflow, process and CRM state.
- [x] Implement app-local fixes and focused regression coverage.
- [x] Verify both native decisions and existing-case recovery on the running application.
- [x] Record final test/build results and cleanup evidence.

Final result: **TC-023 2/2 PASS**, no retries or skips, including awaited duplicate callback through the discovered compiled worker. Both decisions finish the native workflow and its process projection, create exactly one CRM interaction, and retain the requested stage names. Approved message body equals the displayed immutable draft exactly; rejection records the decision. No outbound message links are created and the body is absent from workflow context/process input. Final screenshots were visually checked. [Test evidence](evidence/integration-023-decisions.json), [approval](evidence/demo-approved-completed.png), [rejection](evidence/demo-rejected-completed.png).

All four original user scenarios recovered through the normal scheduler/worker: three approvals at Contacted, one rejection at Observed; each has one interaction, COMPLETED workflow at end, and completed process. Decisions were not changed or resubmitted. [Scoped recovery evidence](evidence/decision-recovery-after.json).

Final checks: 26 unit suites / 221 tests PASS; app typecheck PASS; focused photographers ESLint PASS; generation PASS; production app build PASS; lesson catalog and diff whitespace checks PASS. The test-only Jest invocation sets transformer rootDir and allows transformation of the existing ESM kysely dependency; without the latter one unchanged suite cannot load. No repository Jest configuration or framework file was modified. The full repository gate remains subject to the previously documented unrelated limitations and is not claimed green.

The production application was restarted through the existing CLI on port3001. No schema migration, environment-file edit, dependency change, stage rename, reset or direct repair of business rows occurred. Test fixtures removed their own scoped records/user/organization in the successful teardown. The app remains running. Changes are local and have not been committed or pushed in this correction task.

## Agreed increment 1 — registration to CRM (2026-09-19)

The user approved only this increment after reviewing the CRM concept and existing UI. Deliver an ordinary simulator registration linked to one CRM person and one Hidden Potential deal, with visible links and `eligibility_required`. Reuse matching people and deals, preserve original input, handle retries without duplicate records. No research, scoring, eligibility confirmation, agent execution, batch processing, framework changes, migrations or environment reset. Demo decision repair belongs to another concurrent task.

- [x] Add scoped, guarded CRM preparation and persistent registration-event handling; preserve POST raw-data response.
- [x] Expose existing CRM records from the simulator, including reload/retry and a clear order-check prerequisite.
- [x] Verify matching, replay, conflicts and UI on the running application with owned test fixtures.
- [x] Record evidence, expose the result and stop for user feedback.

Validation runner: local (both standard compose app probes empty). No new database schema is required. Existing application data/configuration must remain intact; tests own their fixture scope.

Delivered on the existing application at http://localhost:3001/backend/photographers/simulator. TC-002 passed 3/3 without retries or skips: real API/concurrent replay, browser save→person→deal→reload, and durable subscriber without simulator. Focused module run: 29 suites / 245 unit tests passed. Package build, generation, production app build, app typecheck, module lint, translation synchronization and whitespace checks passed. A sandbox-only app-build stall was stopped and the same app build passed outside the sandbox; no source workaround. Temporary test organizations/accounts were cleaned up. Framework files and schema unchanged.

Evidence: [verification](evidence/registration-crm-verification.json), [screenshot](evidence/registration-crm-ready.png). These checks establish only the agreed entry slice; evaluation startup/recovery and subsequent phases remain unfinished. The simulator retains the original registration and offers retry when CRM preparation is unavailable or ambiguous.

**Stopped for user feedback.** No next increment started.

## User correction — no order confirmation (2026-09-19)

Every customer entering this process has no orders by definition. This supersedes the eligibility gate in the original plan and first-increment record above. No confirmation UI, command, expiry or prerequisite should be implemented. CRM preparation now returns `ready`; the simulator states that CRM is ready and research has not started. Historical eligibility material schemas remain compatible with existing data, without gating this process. Scope remains increment 1 only.

Correction deployed to port 3001. Verification: 245 module tests and TC-002 3/3 passed (API, browser, subscriber), application typecheck/build and translation/lesson checks passed. No migrations or framework changes. Screenshot registration-crm-ready.png now shows the corrected readiness message. Work remains stopped for user feedback.


### O2 — dopasowanie do szkieletu workflow, 2026-09-19

Zakres tej iteracji: definicja plikowa `photographers.trace_finder` i przekazanie jej wyniku z kroku `o2` do `identity` w nieaktywnym szkielecie z commitu `cc9e576d`. O2 szuka po oryginalnym e-mailu, zwraca najwyżej pięciu kandydatów i źródła; nie wymaga O1 ani Apify. Nie potwierdza tożsamości. Jest to ograniczony wycinek O2, nie ukończenie całego badania.

Adapter `photographers.o2.store_result` przyjmuje wyłącznie `runId`, sprawdza uprawnienia, organizację, workflow, pojedynczą próbę kroku i zgodność wejścia z oryginalną rejestracją. Zapisuje niepotwierdzone ślady istniejącą komendą szyfrowanych materiałów. Zwraca tylko `runId`, `tracesRef` i status; dane źródłowe nie trafiają do kontekstu workflow. Wynik samego wyszukania po e-mailu nie oznacza zakończenia całego discovery. Powtórne próby kroku są na razie odrzucane.

Potwierdzono kod: 40 testów w czterech zestawach, typecheck aplikacji, lint zmienionych plików i generowanie. Runner local. Generowanie wykonano w odizolowanej kopii źródeł; znaleziono agenta w wygenerowanym rejestrze, bez zmian frameworka w repozytorium. Nie zmieniono API ani schematu bazy.

**Niepotwierdzone w aplikacji:** rzeczywiste wyszukiwanie, uruchomienie O2 przez workflow i zapis wyniku na żywej bazie. Szkielet pozostaje wyłączony, bez wyzwalaczy; nie dodano wywołania agenta, workera ani oczekiwania na wynik. Rejestru działającej aplikacji nie przebudowano i aplikacji nie restartowano. Następna uzgadniana iteracja musi podłączyć wykonanie O2 oraz sprawdzić pojedynczą rejestrację od wejścia do zapisanego wyniku. Brak migracji, resetów i zmian `packages/**`. Zatrzymano pracę na informację zwrotną.


### Aktualizacja rejestru O2 — 2026-09-19

Na polecenie użytkownika uruchomiono `yarn generate` w repozytorium (local). Generowanie zakończone powodzeniem; rejestr `file-agents.generated.ts` zawiera `photographers.trace_finder`, powstał również `docker/opencode/agents/photographers_trace_finder.md`. Zmiana w `packages/**` jest wyłącznie automatycznie wygenerowanym wpisem rejestru, objętym tym poleceniem; bez ręcznej zmiany frameworka. Nie przebudowano ani nie restartowano działającej aplikacji/OpenCode. Widoczność na liście w działającej aplikacji nie została jeszcze potwierdzona.


### Restart aplikacji z O2 — 2026-09-19

Na polecenie użytkownika przebudowano pakiet enterprise i aplikację (PASS), następnie uruchomiono ponownie `mercato server start` na porcie 3001. Skompilowany serwer zawiera `photographers.trace_finder`. GET `/backend` zwraca 307 do logowania. Nie uruchamiano O2 ani workflow; widoczność listy w zalogowanej sesji pozostaje do ręcznej weryfikacji. Bez migracji i resetów.


## Uzgodniona partia — krok punktacji workflow

Zakres zatwierdzony przez użytkownika: wypełnić istniejący krok `score`,
a nie budować osobnego kalkulatora ani kontynuować O2/K1. Odczyt faktów,
15 reguł, zapis uzasadnionego wyniku i przekazanie odwołania następnemu
krokowi. Bez propozycji, zmian etapu CRM, nowych ekranów, migracji i zmian
frameworka. Pełny workflow pozostaje wyłączony.

- [x] Obliczenie punktacji i kontrola potwierdzonych źródeł.
- [x] Podłączenie funkcji do przejścia `score → disposition`.
- [x] Sprawdzenie rzeczywistego silnika i bazy oraz końcowa weryfikacja.
- [x] Udostępnienie wyniku i zatrzymanie na informację zwrotną.

Runner: local (oba standardowe compose nie mają uruchomionego app).
Pierwsze uruchomienie TC025 zatrzymało się podczas ładowania aplikacji:
po dołączeniu integracji Apify brakowało lokalnie zainstalowanej zależności.
`yarn install --immutable` uzupełnił instalację bez zmian lockfile; opcjonalny
moduł cpu-features zgłosił ostrzeżenie kompilacji. Nie zmieniono konfiguracji
Apify ani kodu frameworka.

Zakończenie partii punktacji (2026-09-19): 37 zestawów / 365 testów
modułu oraz TC-PHOTOGRAPHERS-025 3/3 bez ponowień przeszły. Test
integracyjny wykonał rzeczywisty silnik i zapis w bazie na własnych danych:
60 punktów, flaga wymuszająca review i odmowa dla niepotwierdzonego źródła.
Potwierdzono szyfrowanie, odczyt API i brak duplikatu oraz zmiany etapu CRM.
Generowanie, build pakietów, typecheck aplikacji, lint zmienionych plików
i kontrola whitespace przeszły. Nie wykonywano produkcyjnego buildu aplikacji.
Naprawiono wykrytą w integracji widoczność aktualnego kroku wewnątrz
transakcji silnika, korzystając z jej EntityManager.

W działającej aplikacji zaktualizowano wyłącznie opis score i przejście
score → disposition w istniejącej definicji przez API z kontrolą wersji.
Pozostałe kroki, w tym O2, zachowano. Widok edytora potwierdza zmianę:
http://localhost:3001/backend/definitions/visual-editor?id=9fc49c7f-1f8d-4d3f-b6ac-fda3d0ec67f6
Pełny workflow pozostaje wyłączony. Rzeczywisty dopływ faktów oraz
niezmiennego rulesSnapshot z wcześniejszych kroków nie jest podłączony.
Identyfikator zapisu jest stabilny dla oceny, factsRef i rulesVersion;
wiele utrwalonych prób kroku score jest obecnie odrzucane jako niejednoznaczne.
Bez migracji, resetów i zmian packages/**.

Użytkownik uznał dodatkową weryfikację ręczną za zbędną, jeśli krok jest
uzupełniony. Partia zaliczona w powyższym zakresie. Praca zatrzymana;
nie rozpoczęto kolejnej partii.

## Uzgodniona partia — wynik z flagą w Caseload

Cel: istniejący score → disposition → review publikuje jedną propozycję
z punktacją, uzasadnieniem i flagą. Bez wykonania decyzji, CRM, wiadomości
i wcześniejszych agentów. Decyzje zostają jawnie zablokowane.

- [x] Podłączenie publikacji z kontrolą zakresu i ponowienia.
- [x] Materiały punktacji w istniejącym Caseload.
- [x] Testy rzeczywistego silnika, propozycji i odczytu oraz testy regresji.
- [x] Aktualizacja działającego kroku, progresu i zatrzymanie na feedback.

Zakończenie: local, 40 zestawów / 429 testów jednostkowych PASS.
TC-021/025/026: 6/6 bez retries PASS (21,5 s): dotychczasowa wiadomość
i odrzucenie, trzy przypadki punktacji, publikacja z flagą i brak publikacji
bez flagi. Rzeczywisty silnik, lokalna kolejka, worker, komendy run/trace/
proposal, zadanie, API i przeglądarka; kontrolowane źródła, bez agentów.
Build pakietów (39 zadań), generate, typecheck aplikacji, scoped lint,
synchronizacja pięciu języków i diff-check PASS. Produkcyjnego buildu
aplikacji i strategii kolejki async/Redis nie uruchamiano.

W istniejącej definicji przez API z kontrolą wersji uzupełniono score
(opis), disposition (opis i wyjście dla flagi), review (oczekiwanie).
Pozostałe kroki i konfiguracja zachowane; enabled=false. Dane testowe
usunięto. Nie wykonano migracji, resetu ani zmian packages/**.

Podgląd jest gotowy, wykonanie decyzji jest jawnie zablokowane.
Upstream facts nadal niepodłączony. W razie awarii między utworzeniem
zadania a zapisaniem linku retry nie dubluje zadania, ale zatrzymuje się
do naprawy powiązania; automatyczna naprawa nie jest wdrożona.
Odrzucamy też wiele utrwalonych prób review.

Dowody: [wyniki](evidence/flagged-score-caseload-verification.json),
[zrzut Caseload](evidence/flagged-score-caseload.png).
Test TC-021 dostosowano do powtórnych odczytów w trybie developerskim:
sprawdza każdy dowód dostępu zamiast zakładać dokładnie jeden GET.
Pełną historię nieudanych prób testów i ich przyczyn zawiera plik dowodów.
**Zatrzymano na informację zwrotną; kolejnej partii nie rozpoczęto.**
