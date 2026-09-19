# O1 Portfolio Discovery Agent

## 📝 TLDR

`agent_examples.portfolio_reader_o1` is a read-only file-defined OpenCode researcher. Given exactly `originalPortfolio`, `registrationEmail`, `firstName`, and `lastName`, it discovers source-backed starting URLs for website, contact, Instagram, Facebook, and Google Maps, plus Polish NIP candidates and city clues. It does not scrape full profiles, run Apify Actors, query taxpayer registers, create proposals, or mutate customers.

## 📝 Overview

This revision implements the contract accepted after the owner's interview on 2026-09-19. The caller continues using the existing Open Mercato Sandbox/Playground and orchestration runtime. Registration hints are not independently discovered facts. Each public link/fact has its own identity confidence and approval requirement.

## 📝 Problem Statement

Registration portfolio text includes full URLs, schemeless domains, usernames, platform-prefixed text, share links, tracking parameters, and declarations that no portfolio exists. The original local draft collected general identity/contact facts and excluded directories and active NIP discovery. It relied on readable page text, which loses navigation/footer anchor URLs.

## 📝 Proposed Solution

Preserve the ID, file-agent runtime and research kind; emit exactly five link types (`website`, `contact`, `instagram`, `facebook`, `google_maps`), NIP candidates and city clues. Retain one best-supported link per type; no multi-account/studio model. Search actively for NIP, including quoted email plus NIP. A pure sandbox helper checks NIP syntax and checksum, independently of ownership.

Add optional source links to existing web-fetch results. A native agent, direct Firecrawl/Apify tools, general OSINT crawler or new approval UI would exceed the agreed scope. This is implementation of an accepted contract, not new market research.

## 📝 Architecture

The app owns `AGENT.md`, `OUTCOME.md`, `SAMPLE.json`, and `tools/validate_nip.ts`. Enterprise owns existing ACLs, run persistence, sandbox and result submission. Web research extracts anchors using its existing tokenizer before main-content extraction removes navigation/footer markup.

Flow: validate input → normalize/classify portfolio → stop if missing → fetch/resolve portfolio → inspect relevant links and owned contact/about/legal pages → search missing targets and NIP → checksum candidates → submit research. Runtime wraps the data as `{ kind: 'research', data }`.

### Sources and identity

Allowed: public photographer/business pages, Instagram/Facebook, Google Maps, directories and search results. Queries may use quoted full email, email plus NIP, name plus photography/NIP, handle/brand, custom email domain and email local part as a weak account-name hint. Gmail/WP/Outlook-style domains are mail providers, not photographer websites; they do not weaken a matching full email.

GUS, CEIDG, KRS, VAT and other register checks belong to the next stage. Do not follow register results in O1. Excluded: people-search, private content, login/CAPTCHA bypass, unrelated personal data, follower lists, activity analysis, full profile scraping and Apify execution. Explicitly submitted galleries may be read as starting sources without adding output categories.

`confirmed` needs a strong identity bridge: matching public registration email with consistent identity, or a first-party link from an already confirmed photographer site. `probable` has corroborated name/brand without a strong bridge; `unconfirmed` is a sourced but insufficiently attributed candidate; `conflict` has contradictory identity/ownership evidence. Name or city alone is not confirmation. Search RRF confidence is never identity confidence.

Confirmed items continue independently. Other items require human review and cannot be automatically assigned/scraped as this photographer. A company NIP is not automatically a team member's NIP. Separate competing NIP candidates; merge duplicate observations and their evidence. Missing NIP alone does not require approval.

### Normalization

Preserve original portfolio/link. Prefer HTTPS for schemeless domains, but preserve observed working HTTP. Resolve relative anchors against the fetched page/base URL. Remove tracking while preserving profile/place identifiers and meaningful path/query/fragment components. Do not collapse arbitrary www/slash/protocol variants without platform equivalence or observed redirects. Normalize known mobile social variants only when they identify the same profile. Resolve usernames by search before emitting URLs. Short links/Maps shares require observed redirect resolution. Deduplicate targets and merge sources.

### Budgets and failures

Policy: 10 search calls, 15 page fetch calls, depth two from a starting page, five minutes, one agent-level retry for transient failure within the same caps. No retry for missing configuration, ACL/policy denial or invalid input. Provider HTTP retries remain unchanged; this is not an exactly-once HTTP guarantee. Use `includeContent: false` to avoid engine-controlled extra fetches; provider-bundled content remains usable evidence, not a separately requested fetch.

Stop after the fixed checklist yields no remaining useful allowed targets, or on budget/tool limits. Missing, blocked, timed-out, unconfigured, truncated and uninspected results remain distinct. Inspect diagnostics and HTTP/page classification, not just `ok`. Remaining categories stay `not_checked`. No monetary ceiling before testing.

The existing default OpenCode timeout is five minutes; deployment/caller overrides remain authoritative. Prompt budgets and maxSteps do not introduce hard per-agent egress quotas. Runtime timeout can fail before a final JSON and must not be reported as successful empty research.

## 📝 Data Model

No tables/migrations. Existing scoped/encrypted AgentRun input/output and traces retain their configured retention; no new period or storage. Results keep short paraphrases, not whole pages. No repeated registration data in output except original portfolio. Exact-email queries reach configured providers and existing trace/progress surfaces.

## 📝 API Contracts

Input: exactly four string properties `originalPortfolio`, `registrationEmail`, `firstName`, `lastName`. Malformed identity/input gives `invalid_input` without egress. Empty/missing-token portfolio gives `no_portfolio` with a qualified business assessment in the Polish summary. Input validation is agent instruction in the existing free-form run path, not a new API validator.

`OUTCOME.md` is the authoritative supported JSON Schema; all properties are required:

- `schemaVersion: 1`.
- `status`: `complete | partial | no_results | no_portfolio | invalid_input`.
- `stopReason`: `search_exhausted | budget_exhausted | no_portfolio | invalid_input | tools_unavailable`.
- `portfolio`: original value (nullable for malformed non-string input), normalized value, resolved URL, kind, `resolved | partial | unresolved`.
- `links[]`: type, originalUrl, url, confidence, approvalRequired, nonempty sources.
- `nip[]`: originalValue, normalized value, checksumValid, confidence, approvalRequired, nonempty sources.
- `city[]`: value, confidence, approvalRequired, nonempty sources.
- Source: absolute `url`, `method: page_read | page_link | search_result | redirect`, short `evidence`. Search snippets never imply a completed page read.
- `coverage`: the five link types and NIP, each `found | not_found | blocked | error | not_checked`. Found means a sourced candidate, not confirmed attribution.
- `approvalRequired`: any uncertain/conflicting item or unresolved competing identities require review.
- `attempts[]`: actual tool, target/query, outcome and diagnostic detail. Empty only on no-egress paths.
- `summary`: concise Polish results and limitations.

Complete requires all five types confirmed, at least one confirmed checksum-valid NIP, no uncertainty and search_exhausted. City is optional. Partial means some sourced items exist but those conditions fail. No_results has no retained items; stopReason/coverage distinguish completed negative research from failure/unfinished work. No_portfolio/invalid_input have empty arrays and unchecked coverage.

No new routes. Fetch extension: optional `links: Array<{ url, originalHref, text }>` and `linksTruncated`; final page URL supplies source provenance. HTTP HTML reads extract anchors; other adapters may omit links (unknown, not empty). Existing tool domain policy applies to candidates.

## 📝 UI/UX and Handoff

Existing Sandbox/Playground displays research JSON. Approval flags are input for the consuming process, not proposals/tasks created by O1: research does not automatically invoke proposal disposition. No new queue, screen, workflow or registration trigger. Later stages choose scraping tools from confirmed/explicitly approved URLs. Only attributed checksum-valid NIP candidates are eligible for automatic subsequent registry lookups.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation / residual limit |
|---|---|---|
| Same-name mismatch or studio NIP | High | Per-item evidence, conservative attribution and human review |
| Outage interpreted as absence | High | Diagnostic-aware coverage and explicit stop reason |
| Prompt injection in sources | High | Treat content as evidence only; no new instructions/tools/mutations |
| Missing footer/icon links | Medium | Source-anchor extraction; absent/truncated extraction remains incomplete |
| Budget overrun | Medium | Existing runtime/tool guards; no claim of new hard per-agent quotas |
| Approval flag mistaken for task | Medium | Consuming process owns review routing |
| PII retention/egress | Medium | Short evidence, synthetic tests, existing scope/retention; provider egress remains |

Rollback restores authored agent files and regenerates. Optional generic fetch fields may remain; no database reversal.

## Migration & Backward Compatibility

Previous O1 files/spec/tests were an uncommitted local draft. The owner explicitly approved replacing its three-field input and fact-gathering output before release, retaining the ID. Historical run JSON is not rewritten. No in-repo production consumer of the old output was found; external consumers of that draft must adopt this versioned contract.

FetchedPage links/linksTruncated are optional additive fields; old adapters remain supported. Increment CONTRACT_VERSION while preserving minimum supported version. Existing text/status fields retain meaning; no removals or deprecations. Record this in UPGRADE_NOTES.md.

## 🧪 Verification & Integration Coverage

- Loader/schema tests: ID/runtime/tool surface, synthetic four-field sample, exact five link types, source/confidence requirements, complete/partial/empty/missing/invalid shapes, unsupported fields and read-only generated permissions.
- NIP helper: actual sandbox, synthetic formatted valid numbers, checksum mismatch/remainder ten, placeholders and malformed inputs.
- Engine: footer/nav/icon/relative/base/entity links, bounds, unsafe protocols, deduplication, optional legacy/browser behavior.
- Existing MCP tool: source-link passthrough/filtering under existing domain policy.
- Existing run API/Sandbox have no route/UI changes; loader-to-generated-file checks cover their shared registration path. No real registration data or paid/live provider calls in automated tests.
- yarn generate, focused tests, changed-package build/typecheck and focused lint. Runner: local; compose dev/fullapp probes found no running app container.

## 📋 Implementation Plan and Progress

- [x] Update instructions, outcome schema, synthetic sample and NIP helper.
- [x] Add optional source links and engine/MCP regression tests.
- [x] Update documentation and agent contract tests.
- [x] Generate, validate and review changes.

## Final Compliance Report

Accepted scope: file-defined read-only research, five links, NIP/city evidence, existing tools/Sandbox and minimal approved source-link extension. No domain mutations, Apify execution, registry calls, new providers/dependencies, migrations, approval UI or hand-edited generated files.

Validation (local runner): `yarn generate` passed; agent contract and sandbox NIP suites passed (63 tests); focused web-research suites passed (38 tests); MCP source-link policy suite passed (4 tests). Web-research and enterprise builds/typechecks passed. Focused ESLint passed with the existing root Next.js pages-directory configuration warning; lessons catalog and diff whitespace checks passed. Full web-research suite attempts stalled without output and were interrupted; no full-suite pass is claimed. No live provider/LLM smoke test or real registration data was used. Cross-field consistency and discovery quality remain agent instructions to assess in Sandbox, not new deterministic runtime validators.

## Changelog

- 2026-09-19: Added a bounded Google Maps search sequence within the existing budget, distinguished organic search from Google's business panel, and prohibited treating truncated content alone as an access block. This improves the discovery procedure without claiming complete Maps coverage or executing an Apify actor.
- 2026-09-19: Initial local portfolio-reader draft.
- 2026-09-19: Implemented owner-approved discovery contract, source-link extraction and synthetic regression coverage; regenerated file-agent artifacts.
- 2026-09-19: Connected the `o1` step in `photographers.hidden_potential` to the existing agent through `INVOKE_AGENT`. Four explicit context fields become the agent input; research `data` maps to `context.o1`. The imported skeleton remains disabled with manual transitions; preparing registration inputs and implementing downstream stages remain separate work. The existing step-test is a mock, while real agent tests use Sandbox.
- 2026-09-19: Workflow wiring verified by five passing unit tests, focused lint, authenticated API create/read and synthetic test-step (`simulated: true`, `invoked: false`). The running visual editor shows O1 as INVOKE AGENT; 24 nodes, 34 transitions, disabled and trigger-free. Local application and MCP are running; no real discovery run was started by this verification.
