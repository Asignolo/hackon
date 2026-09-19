---
title: "Coordinate integration snapshot refreshes through one owner"
modules: ["cli"]
areas: ["testing","debugging"]
topics: ["integration-tests","dev-runtime","source-freshness"]
---

# Coordinate integration snapshot refreshes through one owner

**Context**: Parallel agents prepared a copied application for integration tests while adding test cases in the original workspace.

**Problem**: Copying even a test-only change into the snapshot during its cold build invalidated the CLI source-freshness stamp. A subsequent probe tried to refresh the environment and encountered the still-owned server lock, wasting another build.

**Rule**: Assign one environment owner. Keep fixes in the original workspace and report them; only that owner synchronizes a complete batch into the snapshot. Freeze all snapshot files during startup and exploration, including integration tests. Wait for the owner's explicit ready signal before invoking a CLI command that may refresh or restart the environment. Never remove another process's lock or stop a server just to bypass this coordination.

**Applies to**: copied or isolated integration environments shared by concurrent agents.
