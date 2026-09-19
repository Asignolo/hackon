---
title: "Photographer identifiers name distinct records"
modules: ["photographers", "customers"]
areas: ["module-data"]
topics: ["identity", "data-scoping", "command-pattern"]
---

# Photographer identifiers name distinct records

In photographer evaluation contracts, `photographerId` identifies the CRM
`CustomerEntity`, `personId` identifies its `CustomerPersonProfile`, and
`registrationId` identifies a raw registration. Do not rename a registration
UUID to `photographerId` or introduce a second `entityId` for the same person
in the same contract. CRM interactions and deal-person links use
`photographerId`; profile custom fields use `personId`.

Eligibility may be confirmed for an existing CRM person before a new registration
exists. Validate a registration-to-person relationship when a registration ID is
supplied; do not invent a registration prerequisite for eligibility.

Snapshot author fields such as `confirmedBy` must agree with the authenticated
operator. Permission to store a snapshot does not authorize attributing a decision
to another user.
