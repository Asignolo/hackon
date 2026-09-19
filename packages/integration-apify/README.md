# @open-mercato/integration-apify

Marketplace provider for bounded public-business research through allowlisted Apify Actors. The package exposes no generic Actor runner and does not persist raw datasets in Open Mercato.

## Configuration

Store one tenant-wide `apiToken` through the Integrations Marketplace or preconfigure it with:

- `OM_INTEGRATION_APIFY_API_TOKEN` — required secret for env preconfiguration.
- `OM_INTEGRATION_APIFY_ENABLED` — optional boolean; defaults to `false`.

Reapply the same preset without exposing the token on the command line:

```bash
yarn mercato integration_apify configure-from-env --tenant <tenant-id> --org <organization-id> [--force]
```

The `integration_apify.research` feature is intentionally not granted to any default role. Grant it explicitly only to principals allowed to create paid research runs; it depends on `agent_orchestrator.agents.run`.

Paid tools additionally require an active Agent Orchestrator run with matching tenant scope, a health check from the preceding 15 minutes, a healthy shared rate limiter, scoped tenant credentials, and the integration to be enabled. Operational cost, privacy, actor-build update, canary, cleanup, and rollback procedures are documented in `docs/operations.md`.
