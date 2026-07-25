# Browser Editor Controller Input

**Maturity:** Validated. This browser and PlayCanvas mapping was researched,
implemented, independently reviewed, and accepted through automated plus
physical standard-controller QA for PR 3.4 on 2026-07-25.

## Purpose And Scope

This node maps the engine-independent
[`editor-controller-input`](../../game-concepts/editor-controller-input/README.md)
standard to the browser Gamepad API, React DOM focus, Titan Racers' existing
PlayCanvas editor scenes, and the repository's document-command boundaries.

Read it before implementing or diagnosing controller behavior in a protected
editor. It supplements the validated
[`browser-player-input`](../browser-player-input/README.md) mapping and must not
change gameplay driving or menu behavior accidentally.

## Browser Input Boundary

Poll `navigator.getGamepads()` from `requestAnimationFrame` while an editor is
mounted and enabled. Editor UI and camera behavior are render-facing rather
than fixed-step physics behavior, so the editor adapter owns a separate
frame-polled action stream.

- Accept only connected gamepads whose `mapping` is `standard`.
- Select the first standard controller that produces intentional post-dead-zone
  activity and retain its browser index until disconnect.
- Keep only plain previous axis/button state; do not retain a `Gamepad` object
  as if browser snapshots were stable.
- Apply radial dead zones independently to left and right stick vectors and
  rescale the usable magnitude to retain full range.
- Clamp trigger values and subtract left from right for signed zoom.
- Use entry/release hysteresis and time-based initial delay/repeat for spatial
  and transform-step actions.
- Clear on blur, hidden visibility, disable, context change, disconnect, and
  unmount. Require neutral before re-arming.
- Never read, store, report, or render `Gamepad.id`.

Use physical standard-layout terms in help:

| Editor action | Standard control |
| --- | --- |
| Confirm / viewport select | button 0, south face |
| Back / disengage | button 1, east face |
| Cycle transform axis | button 2, west face |
| Frame selection | button 3, north face |
| Previous / next transform tool | buttons 4 / 5, left / right shoulder |
| Zoom out / in | buttons 6 / 7, left / right triggers |
| Show controls | button 9, center-right menu |
| Spatial movement or screen-relative transform | buttons 12-15, directional pad |
| Pan | axes 0-1, left stick |
| Orbit | axes 2-3, right stick |

## DOM Focus And Spatial Navigation

Use native `HTMLElement.focus()` and `HTMLElement.click()`. Do not synthesize
keyboard events or introduce a virtual cursor.

Build the candidate set from rendered, enabled, non-inert semantic controls:

- buttons;
- links with `href`;
- inputs, selects, and textareas;
- the focusable editor canvas; and
- explicit nonnegative `tabindex` elements.

Exclude elements with no client rectangles, hidden ancestors, disabled state,
`aria-disabled="true"`, or an inert ancestor. Scope candidates to the active
dialog first, otherwise to the editor shell.

For each directional move:

1. Resolve the active focus origin or the declared controller default.
2. Prefer eligible candidates inside the current logical controller region.
3. Filter to candidates whose bounding box lies in or overlaps the requested
   directional half-plane.
4. Prefer projected overlap on the orthogonal axis, then primary-axis distance,
   orthogonal distance, and stable document order.
5. If the current region has no candidate, search the active editor scope.
6. Do not wrap a two-dimensional search.
7. Focus and call `scrollIntoView({ block: "nearest", inline: "nearest" })`.

Use this spatial path for mixed-axis screens such as the home page, where
protected editor links share a horizontal row above vertically stacked game
actions. Retain linear wrapping only for intentionally one-dimensional menus.

Editor markup declares logical regions only for navigation policy. These
attributes never replace semantic landmarks, accessible names, or native focus.

## Focus Engagement

Keep viewport focus and viewport engagement separate.

- A focused canvas remains a normal spatial-navigation candidate.
- Confirm while the canvas is focused sets an explicit engaged state on the
  editor controller coordinator and canvas.
- Clear the adapter and wait for neutral after engagement.
- While engaged, route mapped viewport actions only; do not move DOM focus.
- Back clears engagement, preserves canvas focus, and neutrally re-arms.
- Any modal or workspace lock ends engagement before it changes focus.

Expose engagement through visible styling and semantic help text rather than
changing the canvas role to a nonstandard widget.

## React Ownership

Use one shared editor-controller hook per mounted editor shell. It owns:

- one plain controller adapter;
- animation-frame polling and bounded frame delta;
- spatial focus and native activation;
- active dialog and context detection;
- engagement state plus controller-only presentation;
- one-shot action dispatch into editor callbacks; and
- lifecycle listener attachment and cleanup.

Both editor canvases expose the same narrow imperative controller surface:

- apply normalized pan, orbit, and zoom for the bounded frame delta; and
- request picking at the canvas center; and
- resolve a directional translation request to the signed world axis whose
  camera projection best matches the requested screen direction.

The shells retain document operations such as frame, tool choice, axis choice,
and transform step because those actions must pass through existing validation,
history, availability, and selection rules.

Render controller axis state in the existing transform toolbar when a standard
controller is connected. The X/Y/Z readout is controller feedback rather than
a replacement for the pointer-driven three-axis gizmo.

## PlayCanvas Mapping

Keep the existing repository-owned `EditorOrbitCamera`, `pc.Picker`, transform
gizmos, and editor scene lifecycle.

- Convert normalized stick and trigger values to rate-based camera deltas using
  a bounded seconds-per-frame value.
- Feed pan through `EditorOrbitCamera.pan`, orbit through
  `EditorOrbitCamera.orbit`, and zoom through `EditorOrbitCamera.zoom`.
- Apply the resulting camera once per sampled frame.
- Pick at the canvas CSS center through the scene's existing picker and stable
  selection registry.
- Do not simulate pointer events or drag PlayCanvas gizmo handles.
- Translation projects the positive X, Y, and Z world axes at the camera pivot,
  selects the signed projection best aligned with the pressed D-pad direction,
  and calls the existing document-edit helper through the shell.
- Rotate and scale interpret up/right as positive and down/left as negative on
  the displayed axis. Every repeat-governed step becomes one ordinary history
  command.

PlayCanvas ships a general `CameraControls` script with touch and gamepad
support, but adopting it here would duplicate the editor scenes' accepted
camera state, pointer/touch gestures, framing, and test seams. Reuse the current
camera owner instead of adding a parallel control stack.

## UI And Viewport Arbitration

The editor has one active controller context:

- `ui`: spatial navigation, native activation, back, and help;
- `viewport`: camera, center selection, frame, tool/axis choice, transform
  steps, back, and help; or
- `suspended`: hidden, blurred, locked, torn down, or transitioning.

Context changes clear every edge and continuous value. A single controller
sample cannot act in two contexts. In particular, do not combine navigation
input with a controller-driven virtual mouse; established UI input systems warn
that the same device on both channels can double-trigger actions.

Set controller-navigation presentation on intentional controller activity.
While it is set, suppress the CSS pointer after one second without pointer
movement. Pointer movement restores the pointer during motion; pointer
activation clears controller presentation and controller input state.

## Testing Method

- Construct the plain adapter with injected `getGamepads` and clock
  dependencies.
- Unit-test normalization, edges, repeat, arming, active-index retention,
  disconnect, and context clearing without React or PlayCanvas.
- Unit-test spatial candidate selection with synthetic rectangles and explicit
  visibility/region metadata.
- Inject standard gamepad snapshots in Playwright before editor navigation.
- Assert actual DOM focus, engagement state, camera-state change, stable-ID
  selection, transform history, dialog containment, back behavior, and neutral
  disconnection.
- Retain physical-controller QA for ergonomics, hardware dead zones, platform
  mapping, and long-session comfort.

## Primary Sources

- [W3C Gamepad specification](https://www.w3.org/TR/gamepad/)
- [W3C CSS Spatial Navigation Level 1](https://www.w3.org/TR/css-nav-1/)
- [WAI-ARIA Authoring Practices: Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WAI-ARIA Authoring Practices: Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Microsoft gamepad and remote-control interactions](https://learn.microsoft.com/en-us/windows/uwp/ui-input/gamepad-and-remote-interactions)
- [Unity Input System UI support](https://docs.unity3d.com/Packages/com.unity.inputsystem@1.14/manual/UISupport.html)
- [PlayCanvas camera controls](https://developer.playcanvas.com/user-manual/graphics/cameras/camera-controls/)
- [PlayCanvas editor controls and shortcuts](https://developer.playcanvas.com/user-manual/editor/interface/keyboard-shortcuts/)
- [Unreal Engine viewport controls](https://dev.epicgames.com/documentation/unreal-engine/viewport-controls-in-unreal-engine)
- [Unity scene-view navigation](https://docs.unity3d.com/Manual/SceneViewNavigation.html)

## Known Limits

- CSS Spatial Navigation remains a working draft rather than a generally
  available browser feature, so Titan Racers implements the accepted candidate
  search in application code.
- Native browser behavior for controller activation of text, color, and select
  controls varies; PR 3.4 guarantees navigation and existing semantic access,
  not an on-screen keyboard.
- Synthetic gamepad snapshots cannot prove physical mapping, latency, or
  ergonomic quality.
