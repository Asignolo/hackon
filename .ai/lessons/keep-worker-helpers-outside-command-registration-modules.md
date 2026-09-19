---
title: "Keep worker helpers outside command registration modules"
modules: ["photographers","cli"]
areas: ["architecture","debugging","testing"]
topics: ["command-pattern","module-boundaries","generated-files"]
---

# Keep worker helpers outside command registration modules

**Context**: A worker imported a preparation helper that imported a reusable creation function from a module's `commands/*.ts` file. That file also called `registerCommand` at module load.

**Problem**: The worker loaded the source helper before the generated command loader loaded its separate bundled copy. The same command was registered twice and a real workflow stopped before publishing its proposal, despite mocked unit tests passing.

**Rule**: Keep shared creation functions and entity constants in a pure `lib` module. Command discovery files import those helpers and perform registration; workers, routes, and other helpers must not value-import command registration modules. A re-export from the old command file can preserve existing import contracts. Add a regression that imports the pure helper in isolation and verifies that it does not register commands, then verify the real discovered worker when possible.

**Applies to**: command helpers reused by workers, subscribers, API routes, and dynamically loaded runtime modules.
