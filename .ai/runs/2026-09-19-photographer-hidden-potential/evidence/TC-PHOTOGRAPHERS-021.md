# TC-PHOTOGRAPHERS-021 — Caseload material review

Observed on 2026-09-19 in the shared disposable application with the existing agent module enabled. All records and message contents were synthetic and were removed after the probe. No outbound message action ran.

| Check | Observed result |
| --- | --- |
| Canonical proposal approval before material access | HTTP 409: “Open the current full materials before approving this proposal.” |
| Authorized material preview | HTTP 200 with the exact proposal, option, facts and complete message. |
| Existing Caseload detail page | The “Evaluation materials” region displayed “Own domain”, “Yes”, the synthetic source reference, all three message lines and the internal rationale above the native proposal controls. The fact links to a real stored trace snapshot. |
| Native rejection | “Reject” → “Reason” → “Reject proposal” called canonical dispose and returned HTTP 200 with `disposition: rejected`. |
| Screenshot | [Full material and native controls](TC-PHOTOGRAPHERS-021-materials.png), inspected visually. No credentials, browser storage or real customer data are present. |

The executable regression is `apps/mercato/src/modules/photographers/__integration__/TC-PHOTOGRAPHERS-021-proposal-materials.spec.ts`. The official native runner passed **1/1 tests, no retries, no skips** against the refreshed application at `http://127.0.0.1:58644`. The test took 2.6 seconds; discovery and runner setup brought the total to approximately 93 seconds. The [sanitized result](TC-PHOTOGRAPHERS-021-results.json) retains statuses and timings only. The screenshot above comes from this successful official run. Application typecheck and focused ESLint also passed.

The regression additionally verified `Cache-Control: no-store`, the access record transition from zero to one, absence of message text and source content in both canonical proposal data and access evidence, material refresh, and native rejection.

This is evidence for the material preview and decision guard. It does not prove message delivery, a complete evaluation pipeline, or that a person read the material. The access record proves that the server supplied the current full material to the authorized operator.

Exploration initially exposed test-environment issues: static CommonJS imports split the command registry from the generated ESM bootstrap, and the disposable app initially disabled the agent module. The fixture now loads the real app bootstrap and container through native imports resolved from the app root; the environment owner enabled the existing agent flag and rebuilt. No framework or product workaround was introduced.

| Earlier unsuccessful run | Evidence | Cause and resolution | Owner |
| --- | --- | --- | --- |
| First official TC021 invocation | The runner reported “No tests found” before executing a test. | With `OM_TEST_APP_ROOT`, the existing discovery code reads only the initial module array and misses the conditional addition of `agent_orchestrator`. The successful run used supported monorepo discovery with that optional variable omitted; the fixture resolved the same app directory. Dependency metadata and framework code were preserved. | Agent/QA environment configuration |
