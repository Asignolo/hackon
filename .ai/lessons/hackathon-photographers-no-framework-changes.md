---
title: "Hackathon photographer features must use existing framework capabilities"
modules: ["photographers"]
areas: ["architecture", "umes"]
topics: ["extension-boundaries", "workflow", "scope"]
---

# Hackathon photographer features must use existing framework capabilities

The user clarified on 2026-09-19 that changes to the Open Mercato framework are unwelcome at the hackathon and must not be made for this feature. This supersedes the earlier specification's Caseload-host exception. Keep feature code in the application module and use supported extension points and existing workflow activities. A missing capability is a reason to revisit the application design, not authorization to extend framework code.

Explain such choices in terms of the user's process: start work, wait for a result, show information, approve a decision. Prove an alternative works before claiming equivalent behavior; do not silently remove business requirements or security guarantees.

For a hackathon agent requested on top of existing tools, implement the smallest
working agent and verify it in the existing Playground. Do not stop at recommending
a chain of specification skills or introduce an intermediate business gate the user
did not request. On 2026-09-19 the user explicitly requested O2 to consume O1 output
and call Apify directly; preserve source uncertainty in its research result.

For provider connection checks, verify connectivity and credentials with the smallest
authenticated read. On 2026-09-19 the user rejected Apify's four-Actor metadata,
schema and pricing audit inside the health check. Do not turn a connection test
into a catalog audit or compensate by increasing response limits; retain execution
cost controls separately and describe precisely what a successful check proves.

On 2026-09-20 the user clarified that O2 receives the NIP already discovered by O1.
For registry enrichment, use that existing input rather than designing name search.
The demo requires an Actor without a subscription; verify both per-call pricing and
extra registry credentials before recommending one, especially for sole traders.
When cached Actor descriptions conflict with current pricing, open the pricing page
directly before asserting a subscription requirement. The same day, live pricing
confirmed trev0n/ceidg-scraper charges per result/start, replacing stale rental pricing.

- O2: a surname mismatch alone must not block read-only NIP research when shared contact evidence links the candidate. Preserve attribution uncertainty; never infer marriage from names alone.

- Compare successful Console run INPUT with API inputs when an Apify actor fails. Explicitly pass proxy configuration; a NIP can return both historical and active registrations, so maxResults=1 can hide the current business.
