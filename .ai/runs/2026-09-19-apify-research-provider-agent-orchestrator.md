# Execution Plan: Apify Research Provider for Agent Orchestrator

Source doc: .ai/specs/enterprise/2026-09-19-apify-research-provider-agent-orchestrator.md

## Goal

Ship an independently installable `@open-mercato/integration-apify` Marketplace package that exposes four bounded, typed, read-only AI research tools while failing closed on ACL, AgentRun, credential, quota, concurrency, schema, privacy, and cost controls.

## Scope

- Add the provider package, Marketplace registration, encrypted tenant-wide credential flow, health check, env preset, CLI, i18n, and app wiring.
- Add the official Apify client behind a provider-owned adapter, a closed pinned actor catalog, fail-closed configuration, AgentRun correlation, reservations/leases, bounded execution, normalization, redaction, cleanup, and telemetry.
- Add a scoped AgentRun session lookup and generic shared limiter lease primitive required to enforce tenant/organization correlation and real per-holder concurrency expiry.
- Add four `defineAiTool` registrations for Instagram, Facebook, Google Maps place, and Google Maps reviews.
- Add unit and integration coverage, a test-only Agent Orchestrator smoke fixture, operator documentation, generator output, and the configured validation gate.
- Correct `.ai/agentic.config.json` from the nonexistent `develop` base to the repository's real `main` base, as explicitly authorized for this run.

The source specification is included in this implementation branch because it existed only as an untracked primary-checkout file and had no design PR. This is the smallest reversible choice that keeps the PR's `Source doc:` reference valid and reviewable without modifying the user's dirty checkout.

## Non-goals

- Do not add or modify a production discovery agent, `agent_examples.portfolio_reader_o1`, Agent Orchestrator behavior beyond the additive scoped session lookup, public REST routes, database entities, migrations, webhooks, provider-specific UI, background workers, snapshots, or scheduled refresh.
- Do not expose generic Actor execution, arbitrary actor IDs/input, Apify MCP, raw datasets, reviewer identities, private/personal targets, or automatic retries that could create a second paid run.
- Do not run a paid live canary in CI or without an explicitly provided test token; provide an opt-in canary contract and runbook instead.

## Implementation Plan

### Phase 1: Provider foundation

1. Correct the configured base branch and scaffold the package, workspace/app wiring, module metadata, default-off ACL, Marketplace manifest, tenant-wide credentials, setup, i18n, and documentation shell.
2. Implement provider-owned environment preconfiguration, the rerunnable CLI, a short-lived client factory, and a non-paid health check with sanitized outcomes.

### Phase 2: Runtime safety foundation

1. Implement strict configuration parsing, target validation, a closed actor catalog with exact numeric build pins and contract metadata, stable result/diagnostic contracts, and error redaction.
2. Implement AgentRun resolution, quota and concurrency reservations, scoped credential lookup, bounded start/poll/fetch execution, no-retry paid starts, storage cleanup, and structured telemetry.

### Phase 3: Research tools

1. Implement Instagram profile and Facebook page input factories, normalizers, scope classification, fixtures, and `defineAiTool` registrations.
2. Implement Google Maps place and reviews input factories, normalizers, forced `personalData: false`, reviewer-identity redaction, size limits, fixtures, and tool registrations.

### Phase 4: Verification and operational readiness

1. Add unit, integration, MCP discovery, tenant isolation, Marketplace, health, quota, execution, cleanup, and test-only Agent Orchestrator smoke coverage.
2. Run generation, inspect generated registries, finalize operator configuration/privacy/cost/build-update/rollback documentation, and complete targeted and full validation.

## Risks

- Apify actor pricing, build availability, and input schemas are external and can drift; exact pins and checked-in contract metadata fail closed, while live canaries remain opt-in because no production token is authorized.
- Paid-run ambiguity can create duplicate cost; paid starts have SDK retries disabled and are never retried after an ambiguous outcome.
- Credential, AgentRun, and quota services are cross-module DI contracts; the provider resolves them lazily and returns a safe diagnostic when a required runtime capability is absent.
- This is an additive contract surface: the module, ACL feature, integration ID, and four tool IDs become frozen on release.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Provider foundation

- [x] 1.1 Correct the configured base branch and scaffold provider foundation — 5066f43e
- [x] 1.2 Implement environment preset, CLI, client, and health check — 5066f43e

### Phase 2: Runtime safety foundation

- [x] 2.1 Implement configuration, validation, actor catalog, and result contracts — 10204284
- [x] 2.2 Implement guarded execution, quotas, AgentRun correlation, cleanup, and telemetry — 10204284

### Phase 3: Research tools

- [x] 3.1 Implement Instagram and Facebook research tools — 46906855
- [x] 3.2 Implement Google Maps place and reviews tools — 46906855

### Phase 4: Verification and operational readiness

- [x] 4.1 Add comprehensive automated coverage and Agent Orchestrator smoke fixture — 341b666f
- [x] 4.2 Generate registries, finalize documentation, and complete validation — 341b666f
