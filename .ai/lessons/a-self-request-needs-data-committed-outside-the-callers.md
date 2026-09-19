---
title: "A self-request needs data committed outside the caller's transaction"
modules: ["auth","checkout","query_index","photographers"]
areas: ["module-data"]
topics: ["data-integrity","query-index","workers"]
---

# A self-request needs data committed outside the caller's transaction

**Context**: The checkout demo's `CALL_API` "Create Order Record" activity minted a one-time API key on the request EM (`container.resolve('em')`), then `fetch`ed `/api/sales/orders` with it. It failed with `401 Unauthorized` (issue #4202).

**Problem**: `CALL_API` runs inside `workflowExecutor.executeWorkflow()`'s `em.transactional(...)`. The request EM is forked with `useContext: true`, so while that transaction is open MikroORM's `getContext()` redirects every operation on the container EM — including the API key's persist/flush — into the uncommitted transaction fork. The outbound self-authenticated `fetch` opens a SEPARATE pooled connection that cannot see the uncommitted key, so auth resolution returns null → 401. Resolving `'em'` from the container does not escape this; the transaction context is keyed by EM name via AsyncLocalStorage.

**Rule**: When code must write a row that a subsequent out-of-band request (self `fetch`, worker, another connection) has to read, create/flush it on a context-detached EM: `em.fork({ clear: true, freshEventManager: true, useContext: false })`. That fork commits on its own pooled connection, matching the query_index/webhooks isolated-EM convention.

**Applies to**: `activity-executor` `CALL_API`, any one-time credential minted for a self-request, and anything that persists data then reads it back over HTTP or from a second connection while a transaction is open.

**Advisory-lock variant**: A lock-only `em.fork().transactional(...)` callback also installs an ambient transaction. Container-backed services may write inside it while a later plain `fork()` cannot see those rows, causing false conflicts even without HTTP. For workflows intentionally composed of separately committed commands and durable recovery receipts, hold the advisory lock on an isolated manager with explicit `begin` / `commit` / `rollback`; do not inject that manager into the child commands. If atomic data writes are intended instead, use the transaction manager for every dependent read and explicitly preserve transaction context in nested forks. A unit mock returning the same manager from every fork cannot detect this; include distinct-manager regression coverage and a real database smoke test.
