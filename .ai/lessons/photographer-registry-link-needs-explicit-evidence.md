---
title: "Photographer registry linkage needs explicit evidence"
modules: ["photographers"]
areas: ["spec-pr", "module-data"]
topics: ["identity", "source-data"]
---

# Photographer registry linkage needs explicit evidence

When describing matching, name both the compared values and their sources.
A photographer's surname can match the registration or the supplied portfolio;
a photographic PKD indicates an industry, not a match to an identifier supplied
at registration. Surname plus industry alone does not establish identity.

A confirmed registry entry means its business has been linked to the registered
photographer, not that the business is active. The user accepted an example with
first name, surname and city from the supplied portfolio matching a CEIDG entry,
plus a correlated email address. Preserve this as an example, not a complete
matching algorithm or a requirement that every entry have an email. The full
matching procedure and meaning of email correlation remain to be specified.

Do not ask the business owner to define a separate "confidence that rules were
applied correctly" for deterministic scoring. Code correctness is tested. Low
confidence in a concrete identity proposal and a confirmed adverse business fact
are different reasons for human review. The latter is a flag (for example a
suspended business), not uncertainty: retain its evidence and require a decision
without falsifying confidence or converting potential points to confidence.
