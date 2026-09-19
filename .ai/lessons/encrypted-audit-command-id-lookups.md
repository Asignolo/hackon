---
title: "Read encrypted audit command IDs after scoped retrieval"
modules: ["photographers","audit_logs"]
areas: ["module-data","debugging","testing"]
topics: ["encryption","command-pattern","idempotency"]
---

# Read encrypted audit command IDs after scoped retrieval

The photographer demo changed a CRM stage and wrote its phase receipt, but could not find that receipt before creating the interaction. The audit module's default encryption covers `command_id`. `findWithDecryption` decrypts returned rows; it does not convert plaintext equality predicates into encrypted-field queries.

Retrieve a bounded set through plaintext tenant, organization and resource references, then compare the decrypted command ID. Preserve receipt actor, digest and current-version checks. Never adopt a write merely because the target stage matches. Publication recovery has the same requirement.

Integration fixtures must retain the relevant default encrypted fields. A fixture that omitted `command_id` hid this defect. Raw SQL filtering `command_id` by a plaintext prefix also falsely suggested that no audit rows existed; inspect scoped resource references instead.
