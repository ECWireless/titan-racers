# Protected Course Editor System

## Status

**Maturity:** In progress. PR 3C implementation began on 2026-07-12. Each
planned commit is verified, feature-lead QA tested, and independently reviewed
before publication approval.

## Purpose And Scope

This system replaces the development-only Lite Editor with the protected,
document-driven authoring experience defined by the engine-independent
[`course-editing`](../../game-concepts/course-editing/README.md) standard and
the PlayCanvas mapping in
[`tools/playcanvas-ammo/course-editing`](../../tools/playcanvas-ammo/course-editing/README.md).

The first implementation unit owns protected revision loading, visible access
states, the responsive editor shell, and the command-history foundation. It does
not yet claim that course geometry, selection, transforms, persistence actions,
or lighting controls are implemented.

## Current Source Ownership

- `src/app/editor/page.tsx` is the dedicated editor entry point.
- `src/components/course-editor/course-editor-access.tsx` loads the protected
  rough-course revision, distinguishes authentication, authorization, and
  environment failures, validates successful API responses, starts Google
  login, signs out active editor sessions, and lets an authorized admin
  initialize a missing course from the validated recovery seed without
  overwriting an existing revision.
- `src/components/course-editor/course-editor-shell.tsx` owns the responsive
  course-outline, viewport, inspector, revision, and history-control shell.
- `src/game/editor/command-history.ts` owns apply/revert commands, undo/redo,
  clean-index dirty state, reset-to-loaded, and revision reload semantics.
- `tests/course-editor.spec.ts` covers protected access states plus desktop and
  narrow-screen shell behavior.
- `tests/course-editor-history.spec.ts` covers command and clean-state rules.

## Current Invariants

- A protected API response, not client visibility state, gates the workspace.
- Unknown successful response data crosses the course-document schema before
  entering editor state.
- Seed initialization is offered only after an authorized load returns not
  found; the protected save uses an empty expected revision and treats a
  competing initializer as a reload rather than an overwrite.
- Guest racing remains available without an authentication or database session.
- Command history is document-oriented and independent of PlayCanvas entities.
- Replacing a redo branch invalidates an unreachable clean index.
- Marking a successful save clean also advances the reset baseline to that
  saved document. Reload and reset-to-loaded clear transient history and
  establish clean state.
- Narrow screens keep the viewport primary and expose outline and inspector
  content through focus-contained, Escape-dismissible dialog panels that leave
  the obscured workspace inert and restore focus to their trigger.

## Verification

- Run focused `tests/course-editor-history.spec.ts` coverage once in the desktop
  project.
- Run `tests/course-editor.spec.ts` in desktop and mobile projects.
- Keep direct protected-route denial and competing first-revision coverage in
  `tests/course-persistence.spec.ts` whenever seed initialization changes.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm build` before feature-lead QA.
- Preserve the existing guest and gameplay regression suite.

## Deferred Within PR 3C

- PlayCanvas course viewport construction and picking.
- Palette placement, selection, transforms, and deletion.
- Start and ordered-checkpoint authoring.
- Authoritative collision visualization.
- Lighting controls, save conflicts, reload, reset, and portable export.
