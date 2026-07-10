# Titan Racers Agent Instructions

At the beginning of every session, before editing files:

1. Read `IMPLEMENTATION_PLAN.md`.
2. Read `docs/session-workflow.md`.
3. Read `docs/model-effort-workflow.md` and assess the appropriate effort for the session.
4. Read `skills/README.md` and traverse only the Skills Tree branches relevant to the session.
5. Confirm the current branch and worktree state.
6. Identify the directories likely to change and locate every applicable nested `AGENTS.md` from the repository root down to those directories.
7. Inspect only the required-workflows section of each scoped guide, then read those workflow files.
8. Read and apply the remaining scoped guidance from the repository root down to the directories likely to change.
9. Debrief the phase or task with the feature lead.

Repository workflow files take precedence in the reading sequence. Read the repo-wide workflows before discovering scoped guidance; read any additional workflows named by a scoped guide before applying the rest of that guide.

Nested `AGENTS.md` files may refine instructions for their subtree, but they must not weaken or replace repository-wide workflow, approval, privacy, security, or review requirements. If guidance conflicts, stop and resolve the inconsistency before editing.

Read `docs/pr-review-workflow.md` before opening PRs or handling review feedback.

Do not jump directly into scaffolding, dependency installation, or implementation.

Each phase should begin with alignment on:

- goals,
- non-goals,
- stack choices,
- sequential tasks,
- acceptance criteria,
- verification commands,
- commit and PR boundary.

Use conventional commit messages.

Do not stage, commit, push, open PRs, comment on PRs, or resolve GitHub threads without explicit user approval.

Before ending a branch or preparing a PR, perform the standard final pass from `docs/session-workflow.md`: user-facing QA, code review, and privacy/security review.

After a phase's implementation and verification are complete, run the proportional independent-review gate from `docs/session-workflow.md` before merging the phase into `main`.

For browser QA, prefer the repo's Playwright tests first. Playwright Agent CLI skills may be useful for richer ad hoc browser workflows if installed locally, but they are not required for normal verification.

Do not install or rely on community PlayCanvas skills without reviewing them with the feature lead during the engine spike phase.
