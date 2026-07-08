# Session Workflow

This repo is built phase by phase. Each phase, branch, and PR may happen in a new Codex session, so the working context must be rebuilt deliberately before implementation starts.

## Source Of Truth

`IMPLEMENTATION_PLAN.md` is the active product and technical source of truth.

Older handoff documents, attachments, brainstorms, and chat history are not authoritative unless the project owner explicitly reintroduces them.

## Start Every Session This Way

1. Read `IMPLEMENTATION_PLAN.md`.
2. Confirm the current branch and worktree state.
3. Ask what phase or branch the session is about.
4. Debrief the phase before editing:
   - what we are trying to accomplish,
   - what we are not doing yet,
   - what stack or architecture choices need agreement,
   - what files or systems are likely to change,
   - how the work will be verified,
   - where the PR should stop.
5. Break the phase into sequential tasks.
6. Wait for explicit approval before implementation.

## Phase Planning Checklist

Before writing code, agree on:

- phase goal,
- user-visible outcome,
- technical approach,
- libraries or frameworks,
- data/storage needs,
- environment variables,
- assets to copy or generate,
- testing and verification commands,
- commit strategy,
- PR description shape.

If the agent wants to choose a framework, dependency, service, or major pattern, explain why and get agreement first.

## Implementation Rules

- Keep work scoped to the agreed phase.
- Do not start the next phase without a new debrief.
- Do not install dependencies until the stack choice is agreed.
- Do not install agent skills, community tooling, or PlayCanvas helpers until they are reviewed and agreed for the current phase.
- Do not start a dev server unless the user expects a preview.
- Preserve `.env` and other local secrets.
- Keep `main` as the approved baseline.
- Use feature branches for phase work.
- Use conventional commit messages.

## Review And Closeout

Before asking for review or opening a PR:

1. Run the agreed verification commands.
2. Perform a user-facing QA pass, including browser inspection when the change has UI.
3. Perform a code review pass focused on bugs, regressions, accessibility, and maintainability.
4. Perform a privacy and security pass:
   - confirm `.env` and local secrets are ignored,
   - confirm no tokens, private hostnames, private URLs, or internal-only notes are being committed,
   - confirm public UI copy does not expose implementation details,
   - confirm analytics, uploads, auth, storage, or external calls are intentional.
5. Summarize what changed.
6. Call out any deviations from the plan.
7. Confirm what remains for later phases.
8. Keep the PR boundary narrow enough to review comfortably.

Before opening, updating, or responding to PR review feedback, read `docs/pr-review-workflow.md`.

## Current Branch Strategy

- `main`: approved source-of-truth baseline and merged phase work.
- `feat/app-foundation`: Phase 0 planning and app foundation work.

Future phase branches should be named clearly, for example:

- `feat/engine-spike`
- `feat/driving-prototype`
- `feat/kart-upload-pipeline`
- `feat/agricultural-zone-track`
