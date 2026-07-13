# Protected Course Editor System

## Status

**Maturity:** Candidate. PR 3C implementation is complete as of 2026-07-13 and
awaits final feature-lead QA, independent slice review, and full-phase
integration review before publication approval.

## Purpose And Scope

This system replaces the development-only Lite Editor with the protected,
document-driven authoring experience defined by the engine-independent
[`course-editing`](../../game-concepts/course-editing/README.md) standard and
the PlayCanvas mapping in
[`tools/playcanvas-ammo/course-editing`](../../tools/playcanvas-ammo/course-editing/README.md).

The system currently owns protected access, draft-revision loading, the responsive
authoring shell, document history, a visual-only PlayCanvas course projection,
palette placement, stable-ID selection, transforms, start/checkpoint authoring,
deletion, authoritative collision diagnostics, conflict-safe private draft
actions, lighting controls, append-only publication, and published guest-course
loading. The guest runtime contains no course-authoring surface; its pause menu
owns only Resume and Exit.

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
  deletion, private-draft actions, bounded environment controls, revision and
  conflict state, keyboard commands, and mobile dialog workflow.
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
- `src/components/solo-time-trial-canvas.tsx` consumes the configured published
  course without exposing the removed development editor.
- `src/game/testing/scene-test-adapter.ts` preserves explicit non-production
  physics fixtures for tuning, start placement, obstacle transforms, and scene
  diagnostics without shipping player-facing authoring controls.

## Current Invariants

- A protected API response, not client visibility state, gates the workspace.
- Unknown successful response data crosses the course-document schema before
  entering editor state.
- Seed initialization is offered only after an authorized load returns not
  found; the protected save uses an empty expected revision and treats a
  competing initializer as a reload rather than an overwrite.
- Guest racing remains available without an authentication or database session.
- Guest racing never exposes course-authoring controls. Development-only
  runtime mutations are reachable only through the non-production scene test
  adapter and are absent from production builds. Keyboard users pause with
  Escape, while coarse-pointer or no-hover devices retain an explicit
  safe-area-aware Pause action at every viewport width; both paths open the same
  focus-contained Resume/Exit modal and return focus to the race on resume.
- Command history is document-oriented and independent of PlayCanvas entities.
- History retains the latest 100 commands; a truncated clean boundary remains
  dirty rather than retaining unlimited document snapshots.
- Every palette, rename, nudge, scale, delete, and completed gizmo edit validates
  a portable document and enters history as one coherent command.
- Runtime entities, selection outlines, checkpoint markers, gizmos, and
  collision wireframes remain disposable projections of stable document IDs.
- The protected editor accepts at most 500 course objects and 256 checkpoints,
  disables creation at either limit, retains issued IDs as session tombstones,
  and creates collision diagnostics only while visible.
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
- Marking a successful draft save clean also advances the revert baseline to
  that saved document. Loading the latest draft and reverting changes clear
  transient history and establish clean state.
- Saving a draft never changes the live guest course. A later protected publish
  operation promotes one validated saved revision, and the editor must identify
  draft and live revision state without placing persistence metadata inside the
  portable document.
- Portable JSON is exposed as a secondary Download Backup action for recovery
  and interchange, including unsaved validated work; it is not the ordinary
  save/load mental model.
- Save Draft and `Ctrl/Cmd+S` send the validated current document with the
  loaded draft revision as the optimistic-concurrency expectation. A conflict
  leaves local history and selection intact and offers Download Backup or a
  confirmed Load Latest Draft path; transport and response-validation failures
  likewise retain local work.
- Save Draft and Load Latest Draft are serialized by an immediate in-flight
  guard. Authoring surfaces become temporarily inert until the request settles,
  so the saved/loaded snapshot and command-history clean boundary cannot diverge
  and repeated shortcuts cannot submit competing requests.
- Dirty Exit and Sign Out require the same destructive confirmation used by
  draft recovery. Refresh, close, and external browser navigation receive the
  native before-unload warning while work is dirty. Confirmation dialogs trap
  keyboard focus, close on Escape, and restore the invoking control when the
  author keeps editing.
- Ambient and key/fill lighting controls mutate only bounded portable lighting
  data. Fill is the optional second directional light, and Reset Lighting is
  one history command back to the last loaded or saved draft setup. Manual
  numeric entry clamps to the portable schema bounds before it becomes a
  command.
- The header presents Save Draft as a compact accessible save icon with a
  hover/focus tooltip and disabled clean-state explanation. Course and Inspector
  top-level groups are independently collapsible; their disclosure preferences
  share one versioned browser-local setting across desktop and mobile layouts.
  Invalid or unavailable browser storage falls back to every group open and
  never blocks authoring.
- Narrow mobile headers keep fixed icon actions from shrinking, move Sign Out
  into the Course Actions menu, and use a bounded three-column bottom control
  row with compact Course, draft, and Inspect labels so no action extends beyond
  the viewport.
- Course Actions is an ordinary disclosure action list rather than an ARIA menu:
  its native buttons retain normal Tab order, while Escape restores trigger
  focus and outside pointer interaction dismisses the list.
- The protected editor currently targets the permanent `rough-course` sandbox.
  The source-controlled seed can be restored through the guarded database
  operation documented in `docs/database-operations.md`; the official
  `agricultural-zone` course remains a separate future document and revision
  history.
- Draft and Published revision state are shown separately. Publish remains
  disabled while dirty or when the saved draft is already current, uses a
  compact desktop icon and a mobile Course Actions entry, and submits the known
  publication ID as its optimistic-concurrency base. Publication failure leaves
  the saved draft private and intact.
- Narrow screens keep the viewport primary. The Course outline uses a
  width-contained modal bottom sheet with a scrim and focus containment; the
  Inspector uses a non-modal split-view drawer that resizes the viewport so the
  selected object remains visible during precision edits; short landscape
  screens switch that split to side-by-side.
- The `1`/`2`/`3` transform shortcuts remain available after using editor
  buttons so toolbar interaction does not silently suspend them. They stay
  inactive while typing, while a modal panel is open, or when a browser/system
  modifier is held. Frame and delete shortcuts require viewport focus. Icon
  explanations render as visible hover/focus tooltips, including the
  unavailable Start scale action.

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

## Deferred Work

- Revision history/restore, arbitrary light placement, advanced environment
  rendering, real-time collaboration, and automatic multi-author merging
  remain later production-tooling work.
