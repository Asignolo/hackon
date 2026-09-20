# Photographer source submissions

## O2 — Apify link research

In `/backend/playground`, select `O2 — Apify link research`
(`photographers.apify_link_researcher_o2`) and paste O1's result. It accepts the
data object with `links` and/or `nip`, the complete `{ kind: "research", data }` envelope,
or `{ o1: <data> }`. Run it to look up one NIP and fetch Instagram, Facebook and Google Maps data.
This is a standalone Playground agent; it does not automatically start after O1.

O2 uses five `integration_apify` tools, including `scrape_ceidg_company`. Its output contains a result
per attempted tool, the original attribution flags, skipped targets and a Polish
summary. `resultJson` preserves each entire normalized provider response, including
missing fields, diagnostics and actor run IDs. Conflicting links are skipped;
probable/unconfirmed candidates retain their uncertainty after research.

The NIP lookup uses `trev0n/ceidg-scraper` and the existing Apify API token; no
CEIDG token or Actor subscription is required. It runs first, at most once, and
counts toward the unchanged four-call total. With NIP plus all social targets,
Maps reviews are skipped. With no eligible NIP, the previous social flow remains.
Missing, malformed or conflicting NIP candidates are skipped; the provider checks
the checksum independently. Registry data does not prove the NIP belongs to the
photographer. For the CEIDG result, `url` is the O1 evidence URL, while `resultJson`
contains the normalized registry response. No customer data is updated.

The Apify integration must be configured, enabled, have a recent successful health
check, and the caller must have `integration_apify.research`. Existing provider
quotas apply: defaults allow only two $0.25 reservations per run. Maps place needs
a $0.50 per-call limit; even with the maximum $1 run budget, the global $0.50
reservation allows only two calls. O2 reports budget exhaustion and does not retry.
See `packages/integration-apify/docs/operations.md` for configuration.

Agent source: `agents/apify_link_researcher_o2/`. `SAMPLE.json` contains the supplied
O1 result for Margografia, including a NIP candidate and Instagram and Facebook links. Running this
sample can start paid Apify calls; its identity-conflict evidence may cause the NIP
to be skipped. For a NIP-only lookup, pass `{ "nip": [<O1 candidate>] }` with its
original source evidence and attribution flags. Use `{ "links": [] }` for a
no-target smoke check.
Rebuild package dependencies, run `yarn generate`, and restart
OpenCode after changing the agent files.

This app-local module stores the original registration data in one table,
`photographers_raw_data`. It has no portfolio fetcher, analysis, update, or
delete endpoint. Multiple submissions from the same email/customer are allowed;
each POST creates a new record. Names, email casing, and the raw portfolio entry are
stored without trimming, lowercasing, or normalization. `portfolioRaw` accepts up to 2048 characters, including a URL,
a username/tag, a statement that there is no portfolio, or an empty string.
It is untrusted source text, never a verified clickable link. URL normalization
and decisions about further processing are outside this iteration.

## API

Authenticated staff API: `/api/photographers/raw-data`.

- `POST` requires `photographers.create` and returns `201 { "id": "…" }`.
- `GET` requires `photographers.view`. It returns the standard paginated
  `{ items, total, page, pageSize, totalPages }` response. Optional filters:
  `id`, `customerEntityId`; pagination: `page`, `pageSize` (maximum 100).
- `PUT`, `PATCH`, and `DELETE` are not exposed.

Example POST body:

```json
{
  "firstName": "Anna",
  "lastName": "Kowalska",
  "email": "Anna@example.com",
  "portfolioRaw": "https://www.instagram.com/example/",
  "submittedAt": "2026-09-19T10:00:00+02:00"
}
```

`submittedAt` defaults to receipt time when omitted. `createdAt` is the storage
timestamp; submitted timestamps are represented as instants, not the original
timezone spelling. `customerEntityId` is an optional nullable UUID, validated
against an undeleted CRM customer in the same tenant and selected organization.
It is a scalar reference, not a cross-module ORM relation. Reads never substitute
current customer fields for the original submission.

Tenant and organization come exclusively from authenticated request scope.
Caller-supplied scope fields and unknown fields are rejected. A selected/home
organization is required, including for administrators. Defaults grant the new
features to the admin role; existing installations use the normal
`auth sync-role-acls` command.

For an existing tenant, activate the new encryption map through the existing
`GET /api/entities/encryption?entityId=photographers:photographer_raw_data` and
`POST /api/entities/encryption` configuration API, with `entityId` as above,
`isActive: true`, and `fields` containing `{ "field": "first_name" }`,
`last_name`, `email`, and `portfolio_raw`. Use the intended organization scope
and an identity with `entities.definitions.manage`. Check first and preserve any
existing customized configuration. This activates only the new map and clears
the running application's map cache. Do not reseed all encryption maps on an
existing installation. New-tenant initialization uses `encryption.ts` normally.

The four source strings are covered by the module encryption map. The command
uses `TenantDataEncryptionService` and refuses persistence if any source field
remains plaintext (including disabled or unavailable encryption). Reads use the
CRUD query engine's decryption. Audit and event payloads contain identifiers,
not a second copy of the submitted personal data.

## Registration integration

The existing `/api/customer_accounts/signup` flow accepts email, password and
display name, but neither portfolio nor separate first/last names. Its user-created
event cannot reconstruct these fields. No automatic subscriber is attached.

A future registration form/backend should pass the original fields to this API
under an authorized staff/integration identity. The registered command
`photographers.raw_data.create` is available to trusted server integrations with
the normal command context; HTTP callers must use the guarded API. Public signup
authentication, abuse protection, retries/idempotency and consent policy belong
to that future integration. No new registration system is introduced here.

## Database and verification

The generated migration and snapshot live in `migrations/`. The migration adds
only this table and its scoped date/customer indexes. Applying migrations to an
existing database requires approval; never run greenfield initialization for this
module.

The follow-up migration `Migration20260919075052_photographers` renames
`portfolio_url` to `portfolio_raw` without rewriting stored values, updates only
the matching field in this entity's encryption maps, and declares query-index
reindexing. This unreleased local iteration also replaces the request/response
field `portfolioUrl` with `portfolioRaw`. Restart the application after applying
the migration to discard cached encryption maps, and refresh this entity's query
index when applying the migration outside the standard CLI migration runner.

Unit tests cover input preservation/validation, scope isolation, CRM validation,
encryption failure, and read/create-only route wiring. The API integration test
uses temporary fixtures and checks the live write/read path, access restrictions,
and stored ciphertext, then removes its own records.

The current repository Jest configuration hits TypeScript TS5011 without an
explicit transformer `rootDir`. To run this module's tests without changing the
shared configuration, from the repository root:

```sh
node <<'NODE'
const config = require('./jest.config.cjs')
config.transform['^.+\\.(t|j)sx?$'][1].tsconfig.rootDir = process.cwd()
require('jest').runCLI({
  runInBand: true,
  runTestsByPath: true,
  _: ['apps/mercato/src/modules/photographers/__tests__/raw-data.test.ts'],
  config: JSON.stringify(config),
  $0: 'jest',
}, [process.cwd()]).then(({ results }) => process.exit(results.success ? 0 : 1))
NODE
```

Against an already running, migrated application (the test creates and cleans up
temporary fixtures):

```sh
BASE_URL=http://localhost:3001 OM_INTEGRATION_MODULES=photographers \
  ./node_modules/.bin/playwright test --config .ai/qa/tests/playwright.config.ts \
  TC-PHOTOGRAPHERS-001 --retries=0
```

## Registration simulator

Staff can open `/backend/photographers/simulator` from the Photographers menu.
The four-field form requires `photographers.create` and saves through the existing
POST API. It requires nonblank portfolio text, preserves the original entry, and shows the
saved registration ID before offering a fresh form. It does not start an evaluation. CRM preparation is described below.

## Registration to CRM — first increment

Ordinary authenticated registrations now request CRM preparation through the persistent
`photographers.raw_data.created` subscriber. The original `201 {id}` response and all
four source strings are preserved. Synthetic demo registrations retain their own preparation.

The simulator shows progress, links to the CRM person and one Hidden Potential deal,
and readiness for the next step. Every registration entering this process is assumed to have no orders. No operator confirmation is required. It keeps `registrationId` in the URL,
so refresh and retry recover the same registration. It does not start research or an evaluation.

`GET /api/photographers/registrations/:id/crm` reads the scoped preparation result;
`POST` with `{}` prepares or recovers the same links. Both return no-store responses.
Read requires photographer view plus CRM people/deals/pipeline view; writes also require
`photographers.evaluations.run` and CRM people/deals manage. Insufficient permissions
or unavailable setup do not discard the original registration.

Explicit existing customer links take precedence. Otherwise exact names (trimmed) and
CRM-normalized email must identify one person. Email matching scans scoped people in
pages of 100 and compares decrypted values because the CRM email has no hash lookup.
Ambiguous identities or multiple deals stop with a conflict. Registration/person markers
and scoped locks protect retries; existing CRM stages and source fields are preserved.
No new migration is required. This increment does not implement workflow startup, scoring, message creation or processing historical registrations in bulk.
