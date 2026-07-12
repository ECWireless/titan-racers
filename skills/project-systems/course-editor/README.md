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

The system currently owns protected access, revision loading, the responsive
authoring shell, document history, a visual-only PlayCanvas course projection,
palette placement, stable-ID selection, transforms, start/checkpoint authoring,
deletion, and authoritative collision diagnostics. Persistence actions and
lighting controls remain the next implementation unit.

## Current Source Ownership

- `src/app/editor/page.tsx` is the dedicated editor entry point.
- `src/components/course-editor/course-editor-access.tsx` loads the protected
  rough-course revision, distinguishes authentication, authorization, and
  environment failures, validates successful API responses, starts Google
  login, signs out active editor sessions, and lets an authorized admin
  initialize a missing course from the validated recovery seed without
  overwriting an existing revision.
- `src/components/course-editor/course-editor-shell.tsx` owns the responsive
  course outline, preset palette, transform/history toolbar, inspector nudges,
  deletion, revision state, keyboard commands, and mobile dialog workflow.
- `src/components/course-editor/course-editor-canvas.tsx` owns the React boundary
  for the lifecycle-managed PlayCanvas authoring viewport and test hooks.
- `src/game/editor/course-editor-document.ts` owns bounded presets, unique IDs,
  start/checkpoint/object geometry edits, shape-aware visual/collision scaling,
  human-facing object labels, checkpoint ordering, nudges, and deletion rules.
- `src/game/editor/course-editor-scene.ts` owns visual course projection,
  viewport picking, maintained PlayCanvas gizmos, camera gestures, selection and
  collision wireframes, and one-command transform completion.
- `src/game/editor/command-history.ts` owns apply/revert commands, undo/redo,
  clean-index dirty state, reset-to-loaded, and revision reload semantics.
- `tests/course-editor.spec.ts` covers protected access states plus desktop and
  narrow-screen access, shell, viewport selection, placement, precision edits,
  history, deletion, checkpoint authoring, collision controls, responsive
  transitions, and direct gizmo behavior.
- `tests/course-editor-document.spec.ts` covers preset, stable-ID, collision
  scaling, start placement, checkpoint ordering, and deletion rules.
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
- History retains the latest 100 commands; a truncated clean boundary remains
  dirty rather than retaining unlimited document snapshots.
- Every palette, rename, nudge, scale, delete, and completed gizmo edit validates
  a portable document and enters history as one coherent command.
- Runtime entities, selection outlines, checkpoint markers, gizmos, and
  collision wireframes remain disposable projections of stable document IDs.
- The protected editor accepts at most 500 course objects, retains issued IDs
  as session tombstones, and creates collision diagnostics only while visible.
- Box and checkpoint axes scale independently; cylinder height is independent
  while its two radial axes remain paired to one authoritative collision radius.
  Direct handles and inspector controls preserve the same rule. Collision
  diagnostics never participate in physics.
- Snapping is an explicit toolbar state backed by the maintained PlayCanvas
  transform-gizmo APIs; object labels never replace or mutate stable IDs.
- Collision diagnostics default hidden. The compact icon toolbar retains
  accessible action names, explanatory tooltips, active-state styling, and an
  in-product mouse/touch camera-control reference.
- Start placement cannot be deleted, and checkpoint deletion retains at least
  one checkpoint while restoring contiguous order.
- Mobile authors can select from the viewport or outline, orbit with one pointer,
  pan/pinch with two pointers, and use inspector nudges instead of precision
  reliance on 3D handles. Multi-touch gestures cannot fall through to selection.
- Replacing a redo branch invalidates an unreachable clean index.
- Marking a successful save clean also advances the reset baseline to that
  saved document. Reload and reset-to-loaded clear transient history and
  establish clean state.
- Narrow screens keep the viewport primary. The Course outline uses a
  width-contained modal bottom sheet with a scrim and focus containment; the
  Inspector uses a non-modal split-view drawer that resizes the viewport so the
  selected object remains visible during precision edits; short landscape
  screens switch that split to side-by-side.
- Single-character transform, frame, and delete shortcuts require viewport
  focus. Icon explanations render as visible hover/focus tooltips, including
  the unavailable Start scale action.

## Verification

- Run focused `tests/course-editor-history.spec.ts` coverage once in the desktop
  project.
- Run focused `tests/course-editor-document.spec.ts` coverage once in the
  desktop project.
- Run `tests/course-editor.spec.ts` in desktop and mobile projects.
- Keep direct protected-route denial and competing first-revision coverage in
  `tests/course-persistence.spec.ts` whenever seed initialization changes.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm build` before feature-lead QA.
- Preserve the existing guest and gameplay regression suite.

## Deferred Within PR 3C

- Lighting controls, save conflicts, reload, reset, and portable export.
- Removing the transitional in-race Lite Editor occurs with the final PR 3C
  integration slice, after the protected editor owns the complete save workflow.
