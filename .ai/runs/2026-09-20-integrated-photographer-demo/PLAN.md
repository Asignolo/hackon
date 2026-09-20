# Integrated photographer demo

Goal: registration → real O1 runtime → stored O1 → real Apify O2 runtime → stored O2 → persisted facts/category → existing scoring → saved assessment view. No messages, identity verification, synthetic runtime fallback or scoring-rule changes.

Source: four handoffs in sibling run folders and enterprise photographer MVP/O2/assessment specs.

Worktree: `/private/tmp/hackon-integrated-demo`; branch `codex/integrated-photographer-demo`.

## Decisions

- Demo workflow version 3 uses separate persisted transition boundaries before O2 dispatch and scoring.
- Rules are frozen in workflow context on initial creation; retries reuse them.
- Final scoring re-reads saved facts through the authorized material reader.
- O2 failures stop completion; partial observations retain unknown facts.
- Immutable claims prevent repeated paid calls; uncertain invocation needs operator reconciliation.
- Existing v1/v2 active demos remain unavailable; create a new request after resetting stale database overrides to the code definition. No silent graph migration.
- No schema migrations; regenerate discovered DI/workers/pages using native generator.

## Progress

- [x] Read handoffs and review four source changes; combine commits in isolated worktree.
- [x] Connect v3 graph, O2 runtime, authorized normalization/scoring and final assessment.
- [x] Run combined unit/type/build gates and controlled external-response integration scenarios — 601 unit tests, 6 E2E; external gate failures documented.
- [x] Review final diff and record exact evidence, configuration and limits — implementation 682dfaae.

## Validation

Runner: local (Docker has infrastructure containers only). Native ephemeral runner uses a disposable database; no migrations applied to user database. No paid external calls authorized or executed.
