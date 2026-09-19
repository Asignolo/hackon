---
title: "Hackathon photographer features must use existing framework capabilities"
modules: ["photographers"]
areas: ["architecture", "umes"]
topics: ["extension-boundaries", "workflow", "scope"]
---

# Hackathon photographer features must use existing framework capabilities

The user clarified on 2026-09-19 that changes to the Open Mercato framework are unwelcome at the hackathon and must not be made for this feature. This supersedes the earlier specification's Caseload-host exception. Keep feature code in the application module and use supported extension points and existing workflow activities. A missing capability is a reason to revisit the application design, not authorization to extend framework code.

Explain such choices in terms of the user's process: start work, wait for a result, show information, approve a decision. Prove an alternative works before claiming equivalent behavior; do not silently remove business requirements or security guarantees.
