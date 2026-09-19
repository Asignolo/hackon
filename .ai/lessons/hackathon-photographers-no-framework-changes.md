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
