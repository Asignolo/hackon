# Photographer registration simulator

## Scope

A minimal authenticated staff panel at `/backend/photographers/simulator`, linked
from the Photographers menu, simulates store registration using the existing
`POST /api/photographers/raw-data` route and `photographers.create` permission.

The form has first name, last name, email, and raw portfolio text. Preserve source
strings. Portfolio is required in the simulator: empty and whitespace-only values are
rejected. Addresses, account names and other nonblank raw text are accepted. Submission time comes from the
server. Each successful submission shows its ID and offers a fresh form.
Failures retain entered values and show the shared form error state.

The panel saves real source registrations in the selected organization. It does
not create CRM people, start evaluation, or send messages. No database, API,
permission, or public signup changes are needed.

## Migration & Backward Compatibility

Additive app-local backend page and English/Polish translations only. Existing
submission API, encryption, command side effects, and tenant scoping are reused.
No dependencies or migrations.

## Integration coverage

`TC-PHOTOGRAPHERS-001` covers isolated organization/user/encryption fixtures,
authorized POST/GET, denied access and cross-organization isolation. The same
self-cleaning test now fills the simulator, submits through its real POST route,
checks the success ID, reads back the exact source strings, and opens a blank form
for the next registration.

## Changelog

- 2026-09-19: Required nonblank portfolio in the simulator following user correction.
- 2026-09-19: Added the simulator, navigation, translations and UI coverage.
