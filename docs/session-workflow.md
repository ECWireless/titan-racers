# Session Workflow

This repo is built phase by phase. Each phase, branch, and PR may happen in a new Codex session, so the working context must be rebuilt deliberately before implementation starts.

## Source Of Truth

`IMPLEMENTATION_PLAN.md` is the active product and technical source of truth.

Older handoff documents, attachments, brainstorms, and chat history are not authoritative unless the feature lead explicitly reintroduces them.

Check off completed items in `IMPLEMENTATION_PLAN.md` as each phase lands. At the end of the final phase, remove `IMPLEMENTATION_PLAN.md` entirely so the shipped app, README, and durable docs become the source of truth.

## Start Every Session This Way

1. Read `IMPLEMENTATION_PLAN.md`.
2. Read `docs/model-effort-workflow.md` and assess the appropriate effort for the session.
3. Read `skills/README.md`, identify the branches relevant to the session, and follow their indexes only as deeply as the work requires.
4. Confirm the current branch and worktree state.
5. Identify the directories likely to change.
6. Locate every applicable nested `AGENTS.md` from the repository root down to those directories.
7. Inspect only the required-workflows section of each scoped guide, then read those workflow files.
8. Read and apply the remaining scoped guidance from the repository root down to the directories likely to change.
9. Ask what phase or branch the session is about.
10. Debrief the phase before editing:
   - what we are trying to accomplish,
   - what we are not doing yet,
   - what model effort is appropriate,
   - what stack or architecture choices need agreement,
   - what files or systems are likely to change,
   - how the work will be verified,
   - where the PR should stop.
11. Break the phase into sequential tasks.
12. Wait for explicit approval before implementation.

Repo-wide workflow files are read before scoped guidance so the session-wide process and approval boundaries are established first. Any additional workflow named by a scoped guide is read before the rest of that guide is applied. Nested `AGENTS.md` files may refine instructions for their subtree, but they must not weaken or replace repository-wide workflow, approval, privacy, security, or review requirements. Stop and resolve any conflict before editing.

## Phase Planning Checklist

Before writing code, agree on:

- phase goal,
- user-visible outcome,
- model-effort recommendation,
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
5. Check off completed implementation-plan items for the phase.
6. Summarize what changed.
7. Call out any deviations from the plan.
8. Confirm what remains for later phases.
9. Keep the PR boundary narrow enough to review comfortably.

Before opening, updating, or responding to PR review feedback, read `docs/pr-review-workflow.md`.

## Pre-Merge Independent Review

Run an independent review after a phase's implementation and verification are complete but before merging it into `main`. This is a pre-merge gate, not a ritual required whenever an unfinished session ends.

### Reviewer Count

- Use one fresh-context, read-only reviewer for a normal completed phase.
- Use two specialized reviewers when the phase materially changes privacy, security, authentication, data migrations, foundational architecture, external integrations, or other high-consequence boundaries.
- Add more reviewers only when they have clearly distinct review responsibilities. Repeated general reviews create noise rather than confidence.

Suggested specialties are:

- **Technical and gameplay reviewer:** correctness, failure modes, tests, architecture, runtime behavior, physics and input behavior, dependency choices, unnecessary complexity, and phase-scope compliance.
- **Security and privacy reviewer:** authentication, authorization, secrets, analytics, data handling, uploads, external integrations, and trust boundaries.
- **Experience reviewer:** user-visible behavior, accessibility, responsive layout, control clarity, and keyboard, touch, and gamepad experience when a phase has substantial interface or gameplay work.

### Review Procedure

1. Finish the agreed implementation and run its verification commands.
2. Freeze implementation edits while the review is in progress.
3. Give each reviewer the approved phase goal, acceptance criteria, stopping point, relevant project docs, and complete diff from the approved `main` baseline.
4. Keep reviewers read-only. They report findings but do not edit files, create commits, merge, or broaden scope.
5. Require evidence-based findings with severity, file and line references when applicable, the violated contract or risk, and a concise correction direction. Reviewers should explicitly say when they found no actionable issue.
6. Classify findings as:
   - **P0:** catastrophic or unsafe; blocks acceptance immediately.
   - **P1:** material correctness, security, privacy, or data-loss issue; blocks merge.
   - **P2:** important scope, maintainability, testing, accessibility, gameplay, or operational issue; normally fix before merge.
   - **P3:** minor improvement that may be fixed now or deliberately deferred.
7. The implementing agent evaluates every finding rather than accepting it blindly, applies agreed fixes, and reruns affected verification.
8. Ask the original reviewer for a focused re-review of material fixes and any disputed or unresolved finding.
9. Record only material deferred or unresolved findings in `IMPLEMENTATION_PLAN.md`; do not create permanent review documents for fully resolved routine findings.
10. Present the final evidence and review disposition to the feature lead. The feature lead remains the merge authority.

Independent agent review supplements rather than replaces automated tests, runtime verification, privacy and security checks, and the feature lead's product, gameplay, or visual acceptance.

When sub-agents are unavailable, perform a separate fresh-context review pass and disclose that the review was not independently delegated.

## Current Branch Strategy

- `main`: approved source-of-truth baseline and merged phase work.
- `feat/app-foundation`: Phase 0 planning and app foundation work.

Future phase branches should be named clearly, for example:

- `feat/engine-spike`
- `feat/driving-prototype`
- `feat/kart-upload-pipeline`
- `feat/agricultural-zone-track`
