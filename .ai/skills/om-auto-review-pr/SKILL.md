---
name: om-auto-review-pr
description: Open Mercato repo-local extension of the shared `om-auto-review-pr` skill (installed from open-mercato/skills into .agents/skills/). Uses local validation instead of GitHub Actions and keeps this repo's stricter verdict rule (Medium findings request changes).
---

# Auto Review PR — Open Mercato extension

This file extends the shared `om-auto-review-pr` skill from [open-mercato/skills](https://github.com/open-mercato/skills) (installed at `.agents/skills/om-auto-review-pr/SKILL.md`). Follow the shared skill's full workflow — claim protocol, worktree isolation, review, verdict, labels, autofix loop, lock release — with the repo-specific rules below layered on top. The `om-code-review` step also picks up this repo's own extension at `.ai/skills/om-code-review/SKILL.md`.

## Local validation (repository policy)

This repository does not use GitHub Actions as a validation or merge gate. Local validation replaces CI, including when historical GitHub checks remain queued or pending.

- Run the applicable commands from `.ai/agentic.config.json` on the exact reviewed commit in an isolated worktree, using the local/Docker runner selection documented in `.ai/docs/agent-instructions.md`.
- Record the commit SHA, runner, commands, outcomes, and any limitations in the PR review or validation report. Existing evidence is reusable only for the same commit and relevant scope.
- Code changes must pass the configured validation gate. Documentation-only changes use document consistency and `git diff --check`; inactive workflow version updates use diff and YAML validation.
- Missing, queued, skipped, or disabled GitHub Actions checks do not block review or merge. Do not wait for them or start CI monitoring.
- Actual local test failures, unresolved review findings, conflicts, and the QA label gate still block merge.
- After updating a branch, repeat checks affected by the changes and identify the new commit in the report.

These rules override the shared skill's CI checks-first and pending-check early-exit behavior for this repository.

## Verdict rule (stricter than the shared default)

This repo requests changes on Medium findings too:

| Condition | Decision |
|-----------|----------|
| Any Critical/blocker, High/major, or Medium/minor finding | `changes_requested` |
| Only Low/nit findings | `approved` |
| No findings | `approved` |

## Repo conventions the shared workflow already parameterizes

- Base branch: PRs target `main` (config `baseBranch`); the PR's own `baseRefName` stays authoritative for diffs.
- Labels, QA gate, and claim protocol: as defined in `.ai/agentic.config.json` and root `AGENTS.md` (QA-approval merge gate: `needs-qa` without `qa-approved` never merges; auto-skills never touch the `qa` pipeline label).
