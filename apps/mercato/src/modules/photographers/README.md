# Photographer source submissions

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
saved registration ID before offering a fresh form. It does not start an evaluation
or create a CRM person.
