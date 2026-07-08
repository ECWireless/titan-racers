# Titan Racers Agent Instructions

Before starting any new phase, branch, PR, or substantial implementation work:

1. Read `IMPLEMENTATION_PLAN.md`.
2. Read `docs/session-workflow.md`.
3. Read `docs/pr-review-workflow.md` before opening PRs or handling review feedback.
4. Debrief with the project owner before editing files.

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

For browser QA, prefer the repo's Playwright tests first. Playwright Agent CLI skills may be useful for richer ad hoc browser workflows if installed locally, but they are not required for normal verification.

Do not install or rely on community PlayCanvas skills without reviewing them with the project owner during the engine spike phase.
