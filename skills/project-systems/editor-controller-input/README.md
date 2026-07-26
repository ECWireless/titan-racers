# Editor Controller Input System

## Status

**Maturity:** Validated. PR 3.4 implementation, static checks, production
build, deterministic adapter and spatial-navigation tests, representative
browser QA, required independent review, and feature-lead physical-controller
acceptance pass as of 2026-07-25.

## Purpose And Scope

This node documents Titan Racers' implemented best-effort controller path for
the home screen and protected course and kart editors. It combines the
engine-independent
[`editor-controller-input`](../../game-concepts/editor-controller-input/README.md)
standard with the browser and PlayCanvas mapping in
[`browser-editor-controller-input`](../../tools/browser-editor-controller-input/README.md).

The system owns standard-gamepad editor actions, DOM focus movement, viewport
engagement, camera input, center selection, tool and axis cycling, snapped
directional transforms, controller-only presentation, and lifecycle clearing.
It does not own driving input, portable course or kart document formats,
authentication, persistence, or PlayCanvas gizmo dragging.

## Source Ownership

- `src/game/input/editor-gamepad-input.ts` owns standard mapping, radial stick
  dead zones, active-controller retention, neutral arming, edge detection,
  directional hysteresis, and time-based repeat.
- `src/game/input/editor-spatial-navigation.ts` selects deterministic focus
  candidates from screen rectangles, direction, logical region, distance, and
  document order.
- `src/game/input/use-editor-controller.ts` coordinates editor DOM focus,
  dialogs, viewport engagement, controller callbacks, pointer ownership, and
  blur, visibility, disconnect, disabled-state, and teardown cleanup.
- `src/game/input/use-controller-menu-navigation.ts` retains linear menu
  behavior for race overlays and provides opt-in spatial home navigation.
- `src/game/editor/editor-controller-viewport.ts` defines the narrow shared
  viewport bridge and the pure screen-projection transform resolver.
- `src/game/editor/editor-viewport.ts` applies rate-based controller camera
  input and projects world axes into the current camera view.
- `src/game/editor/course-editor-scene.ts` and
  `src/game/editor/kart-editor-scene.ts` bridge camera, picking, and projection
  behavior into their existing scene owners.
- Both editor canvas components expose the same narrow imperative controller
  handle; both shell components route authoring actions through existing
  validation, history, snapping, and tool-availability rules.
- `src/components/editor-controller-axis-indicator.tsx` presents the
  controller-selected X, Y, or Z axis beside the existing transform tools.
- `src/components/play-home.tsx` enables spatial navigation across the
  horizontal protected-editor row and vertical game-mode actions.
- `src/app/globals.css` hides the idle pointer during controller navigation
  while allowing pointer movement or activation to reclaim presentation.

## Runtime Flow

1. Each enabled editor polls connected standard-mapped gamepads from an
   animation frame and remains disarmed until a neutral sample is observed.
2. UI context maps the left stick or D-pad to actual DOM focus, confirm to
   native activation, back to the current safe cancellation path, and the menu
   button to controller guidance.
3. Confirm on the focused viewport enters an explicit engaged context and
   clears retained input before accepting viewport actions.
4. Engaged sticks pan and orbit, triggers zoom, confirm selects at the visible
   reticle, north-face frames, shoulders cycle tools, west-face cycles axes,
   and the D-pad requests repeat-governed snapped transforms.
5. Translation projects positive world axes at the camera pivot, chooses the
   signed axis best aligned with the requested screen direction, and commits
   through the editor's existing document operation. Rotate and scale apply
   the requested sign to the displayed controller axis.
6. Back, modal entry, focus departure, blur, hidden visibility, disconnect,
   workspace lock, and teardown end engagement and require neutral re-arming.

## Accepted Invariants

- Editor controller state never enters course or kart documents, persistence,
  analytics, or publication data.
- Only controllers reported with `mapping === "standard"` participate; device
  IDs are never read, stored, rendered, or reported.
- DOM focus is the sole UI activation target. Focus movement never authors a
  selection until confirm activates the focused control.
- The viewport must be both focused and explicitly engaged before camera or
  transform input is accepted.
- Dialogs suspend engagement, constrain controller focus, prefer safe back
  actions, and restore logical invoker focus.
- Every snapped controller edit passes through existing availability,
  validation, history, and document-command boundaries.
- Controller detection never disables keyboard, pointer, or touch input.
- Controller presentation clears on pointer activation, blur, visibility loss,
  disconnect, disable, and teardown. Pointer movement temporarily restores the
  cursor while controller focus remains active.
- Home navigation follows visible geometry: up/down moves between rows and
  left/right traverses the horizontal protected-editor row.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check` pass.
- `tests/player-input.spec.ts` covers mapping, radial dead zones, neutral
  arming, edges, repeat, active-index retention, disconnect, context clearing,
  spatial candidate selection, and representative camera projections.
- The complete desktop course and kart editor suites pass with 37 tests and 2
  expected skips.
- Focused browser cases cover home spatial navigation, cursor handoff,
  viewport engagement, camera movement, center selection, shoulder tool
  cycling, axis feedback, screen-relative snapped edits, modal cancellation,
  blur, disconnect, and neutral re-arming.
- A fresh-context independent review found and verified fixes for
  disconnect/blur presentation clearing and deterministic camera-projection
  coverage, then found no actionable issues in the final spatial-navigation
  and axis-indicator delta.
- Feature-lead physical-controller QA accepted both protected editors and the
  final home, cursor, camera, shoulder, D-pad, and axis-feedback behavior.

## Known Limits

- Text entry, color editing, drag-shaped transforms, and precise arbitrary
  placement may still require keyboard, pointer, or touch.
- Remapping, controller glyph selection, vibration, nonstandard mappings, and
  simultaneous editor operation by multiple controllers remain outside PR 3.4.
