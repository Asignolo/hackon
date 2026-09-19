# Apify Research Operations

`@open-mercato/integration-apify` is a default-off paid-egress provider. It exposes four closed research tools and never exposes a generic Actor runner, credentials, arbitrary Actor input, or raw datasets.

## Enablement

Configure one tenant-wide API token in the Integrations Marketplace, enable the integration for that tenant and organization, and explicitly grant `integration_apify.research` to the role that runs Agent Orchestrator research. The permission depends on `agent_orchestrator.agents.run` and is intentionally absent from default role grants.

Environment preconfiguration is optional:

```bash
OM_INTEGRATION_APIFY_API_TOKEN=...
OM_INTEGRATION_APIFY_ENABLED=false
yarn mercato integration_apify configure-from-env --tenant <tenant-id> --org <organization-id>
```

Use `--force` only for an intentional credential rotation. The command never prints the token.

## Cost and concurrency controls

Every call requires an active `AgentRun` and reserves its worst-case cost before credentials are read. The default limits are:

| Control | Default | Compiled maximum |
| --- | ---: | ---: |
| Actor charge limit | USD 0.25 | USD 0.50 |
| Actor deadline | 120 seconds | 180 seconds |
| Result items | 25 | 25 |
| Calls per AgentRun | 4 | 8 |
| Risk budget per AgentRun | USD 0.50 | USD 1.00 |
| Calls per tenant/hour | 30 | 120 |
| Risk budget per tenant/hour | USD 5.00 | USD 20.00 |
| Concurrent runs/process | 4 | 8 |
| Concurrent runs/tenant | 2 | 4 |

The Google Maps place Actor currently requires a USD 0.50 minimum charge, so that catalog entry reserves and passes USD 0.50 even when the general default is USD 0.25. The provider fails closed when the shared rate limiter is disabled, missing, or degraded. Production multi-process deployments must use the shared Redis limiter; the memory limiter is suitable only for development or one process.

The matching environment variables are listed in `apps/mercato/.env.example`. Invalid values do not loosen a limit; paid execution is refused with a sanitized diagnostic.

## Privacy and retention

Use the tools only for a documented lawful purpose and public-business research. Instagram personal/private profiles and Facebook personal profiles, groups, posts, and events are outside scope. Google Maps review requests force `personalData: false`; reviewer name, profile URL, avatar, and identifiers are never included in normalized results.

Raw datasets stay in process memory only until normalization. The provider then attempts to delete the exact dataset, key-value store, and request queue attached to the run. It preserves the Actor run record and `actorRunId` for audit. Configure an appropriate Apify workspace retention policy and DPA independently of this best-effort cleanup.

When a `cleanup_failed` diagnostic appears, use `actorRunId` in the Apify console/API to locate the run and delete its attached storage. Do not paste raw dataset content, target URLs with query parameters, credentials, review text, or profile biography into operational tickets.

## Pinned-build update runbook

Actor IDs, numeric builds, Apify build IDs, input-schema hashes, pricing model, and fixture versions live only in `lib/actor-catalog.ts`. Never replace a pin with `latest`, `beta`, or an environment-selected build.

For an update:

1. Confirm the Actor pricing model and minimum charge in Apify.
2. Record the exact numeric build and immutable build ID.
3. Hash the canonical input schema and update the catalog entry.
4. Refresh only anonymized contract fixtures and run the package tests.
5. With an explicitly authorized test workspace/token, run one minimum-size public target per changed Actor and record only status, shape/hash, and cost.
6. Review the normalized output for new personal fields, schema drift, larger output, and changed platform-block behavior.
7. Ship the build change as its own reviewed PR.

CI never performs paid live canaries. The Marketplace health check authenticates and verifies the four pinned builds and schema hashes without starting an Actor.

## Incident response and rollback

For cost, privacy, or schema incidents, revoke `integration_apify.research` first, disable `integration_apify` for affected scopes, and rotate the token if credential exposure is suspected. These steps stop new calls without removing stable tool IDs or historical run audit data. Use the existing AI tool override mechanism only when a global emergency disable is required.

Failures return closed diagnostics with `retryable: false`; agents must not automatically retry a paid start. A network error after the start request may leave a paid run whose ID is unknown, so inspect the Apify workspace manually instead of replaying the request.
