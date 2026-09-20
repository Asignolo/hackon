# Process loading and encryption repair

## Plan

- [x] Trace the failed execution through API responses, workflow logs and scoped encryption-map metadata.
- [x] Repair missing agent-orchestrator encryption maps in the affected organization using the existing `upsertEncryptionMapSpecs` helper; preserve existing maps and keys.
- [x] Verify encryption and decryption of non-sensitive probes through the real application DI service, without invoking agents.
- [x] Render pending and pre-workflow failures by execution ID, then read proposals using the resolved workflow ID.
- [ ] Run regression tests and validate the running application after deployment to local main.

## Configuration

Enabling `TENANT_DATA_ENCRYPTION` and providing a key does not seed tenant encryption maps. After enabling the enterprise agent module for an existing tenant, generate registries and seed its declared encryption maps for the intended tenant/organization. The standard CLI is `yarn mercato entities seed-encryption --tenant <tenant-id> --org <organization-id>`; it reapplies all enabled module defaults, so review intentional customizations before running it. A selective repair can use the existing `upsertEncryptionMapSpecs` helper with only missing declarations from the owning module's `encryption.ts`.

The O1/O2 preflight remains fail-closed. Repairing maps does not retry an evaluation or change a failed workflow to completed. Existing failed evaluations remain audit history; a new evaluation requires a new request ID. No database schema migration or external model/Apify call is part of this repair.

## Verification

Real DI encryption probes passed for all ten declared agent-orchestrator maps, photographer evaluation material, and audit payloads. Both ciphertext change and round-trip equality were checked; probe values were not persisted as agent runs or evaluations.

Runner: local (no Compose app container). Enterprise regression suites: 83/83 tests; additional execution outcome/API/encryption selection: 40/40 tests (overlapping selections, not summed). Enterprise typecheck and targeted lint passed. Package build: 39/39 tasks passed. Registry generation passed with enterprise/agents enabled. Initial outcome-render test required generated core artifacts; it passed after generation/build. Browser verification was stopped at the user’s request.
