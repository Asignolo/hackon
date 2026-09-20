# Read-only photographer assessment

User scope: isolate the view and read adapter from parallel workflow/o1/o2/scoring work. No business actions, identity approval, demo writes or changes to launch form.

- [x] Inspect existing material contracts, scoped reads, registration/CRM links and UI conventions.
- [x] Add a scoped, authorized assessment read endpoint using existing encrypted materials and actual process states.
- [x] Add a dedicated guarded page, separated client read adapter, registration/CRM context, stages, sources, facts, score and missing/error states.
- [x] Verify pending, partial, completed, failed, forbidden and scope changes with controlled tests; attempt browser validation.
- [x] Record integration hooks, validation limits and commit the isolated branch.

Runner: local (neither configured Docker compose has a running app). Existing app on port 3000 serves main checkout, not this worktree. Dependencies may be read via a local symlink; no production dependencies added.
