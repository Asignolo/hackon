# Photographer hidden potential implementation

Source: [specification](../../specs/enterprise/2026-09-19-photographer-hidden-potential-mvp.md).

## Governing decision — 2026-09-19

The user requires no Open Mercato framework changes for the hackathon. All previous task edits under packages were withdrawn. The current design uses only the photographers application module and existing extension points. This replaces the former Caseload-host exception and proposed custom workflow activity prerequisites. The original business scope remains unchanged.

## Current increment

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
