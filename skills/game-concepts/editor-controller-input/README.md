# Editor Controller Input

**Maturity:** Validated. This engine-independent standard was researched,
implemented, independently reviewed, and accepted through automated plus
physical standard-controller QA for PR 3.4 on 2026-07-25.

## Purpose And Scope

This node defines the best-effort Titan Racers standard for operating bounded
3D editors with a standard-mapped controller. Read it before changing
controller navigation, editor focus, viewport camera input, controller
selection, controller transform steps, or editor control guidance.

It extends the validated
[`player-input`](../player-input/README.md) lifecycle and device-isolation
principles into authoring tools. It does not require controller parity for text
entry or pixel-precise freeform placement, change either portable document
format, or prescribe browser or PlayCanvas APIs. Browser and engine mapping
belongs under [`../../tools/`](../../tools/README.md).

## Standard

Treat controller input as replaceable editor actions, never as course or kart
document data. Keep UI navigation and 3D viewport interaction as explicit
contexts around one visible point of DOM focus.

The viewport is a focus-engaged composite control:

1. Spatial UI navigation can focus the viewport without manipulating it.
2. Confirm engages the focused viewport.
3. Engaged viewport controls operate the camera, selection, framing, active
   transform tool, axis, and bounded snapped step.
4. Back disengages the viewport without losing its visible focus.
5. A subsequent spatial move leaves the viewport for the nearest eligible UI
   control.

Clear and neutrally re-arm controller state whenever the context changes. A
button that opened, closed, engaged, or disengaged a context must never leak
into the new context.

## Desired Outcome

- Controller users can reach editor headers, toolbars, outlines, inspectors,
  dialogs, and primary actions without requiring pointer emulation.
- Focus movement follows the visible layout and always has a clear,
  high-contrast on-screen indicator.
- Horizontal controls that share a visual row respond to left/right movement;
  vertical movement enters or leaves that row according to screen geometry.
- Controller focus and authored object selection remain visually and
  semantically distinct.
- Both editor viewports provide rate-independent orbit, pan, zoom, center-point
  selection, framing, transform-tool choice, axis choice, and snapped
  manipulation.
- Dialogs suspend viewport engagement, constrain focus, prefer safe defaults,
  and restore logical focus when closed.
- Connection, disconnection, focus loss, visibility loss, modal transitions,
  and teardown cannot leave camera or authoring input held.
- Keyboard, pointer, and touch behavior remains concurrently available.
- The interface says where controller precision ends rather than claiming
  complete device parity.

## Normalized Editor Action Model

Keep continuous viewport actions separate from one-shot editor requests.

Continuous actions:

- `panX` and `panY`: normalized left-stick intent;
- `orbitX` and `orbitY`: normalized right-stick intent; and
- `zoom`: normalized right-trigger intent minus left-trigger intent.

One-shot or repeat-governed actions:

- spatial focus movement in four directions;
- confirm and back;
- viewport engagement and disengagement;
- center-point selection;
- frame selection;
- cycle transform tool;
- cycle transform axis;
- apply a snapped transform step in an intended screen direction; and
- show controller guidance.

Device indices, button indices, DOM elements, engine objects, and document
types do not belong in this action model.

## UI Navigation And Focus

Use actual UI focus rather than a controller-only highlight or synthetic
keyboard events. The focused element is the sole activation target.

- Prefer spatial movement that matches visible geometry for the editor's
  multidirectional layout.
- Search visible enabled candidates in the requested half-plane, favor
  directional alignment, then distance and document order.
- Keep local logical regions such as a toolbar, outline, inspector, or dialog
  coherent. Search outside the region only when no suitable local candidate
  exists.
- Do not wrap a multidirectional layout. Linear one-axis lists may wrap when
  that behavior is deliberate and consistent.
- Scroll the chosen target into view before or while moving focus.
- Exclude hidden, disabled, inert, and unavailable controls.
- Preserve native semantic controls and ordinary keyboard tab order.
- Pointer activity may remove controller-only presentation, but it must not
  disable later controller use.

Focus and selection are different states. Moving focus through an outline does
not author a new selection until confirm activates that item.

## Viewport Engagement And Mapping

Use physical positions from the standard gamepad layout rather than
brand-specific device-name inference.

### UI Context

- left stick or directional pad: spatial focus navigation;
- south face: activate the focused control or engage the viewport;
- east face: perform the current non-destructive back action; and
- center-right menu button: show controller guidance.

### Engaged Viewport Context

- left stick: pan;
- right stick: orbit;
- triggers: zoom;
- south face: select beneath the visible center reticle;
- east face: disengage the viewport;
- left/right shoulders: cycle backward/forward through valid translate,
  rotate, and scale tools;
- west face: cycle through X, Y, and Z transform axes;
- north face: frame the current selection;
- directional pad: apply a snapped transform in the pressed screen direction;
  translation resolves the best-aligned signed world axis against the current
  camera, while rotation and scale use negative/positive directions on the
  displayed axis; and
- center-right menu button: show controller guidance.

The interface visibly communicates engagement, the active tool and axis, the
center selection point, and the available controls. Use action names and
physical positions rather than claiming one controller brand's glyphs.
When a controller is connected, display the controller-selected X, Y, or Z
axis beside the transform tools so cycling the axis has immediate visual and
accessible feedback.

## Practical Authoring Boundary

Controller transform steps reuse the editor's document-level validation,
snapping, history, and availability rules. An unavailable tool or axis remains
unavailable; the controller path does not create an override.

When controller navigation is the active input presentation, hide the pointer
after it becomes idle. Show it again as soon as pointer movement resumes, and
clear controller-only presentation on pointer activation.

Best-effort support includes:

- selecting an authored item from the outline or viewport center;
- camera positioning and selection framing;
- choosing a valid transform tool and axis;
- applying bounded snapped transform steps;
- activating existing buttons, disclosures, selects where the browser permits,
  and dialog actions.

Text entry, fine color editing, drag-shaped transforms, and precise arbitrary
placement may still require keyboard, pointer, or touch. This limitation must
be discoverable and must not weaken the supported controller paths.

## Cancellation And Lifecycle

Neutralize continuous values, held directions, repeat schedules, and button
edges on:

- browser blur or hidden visibility;
- active-controller disconnection;
- editor teardown;
- operation lock or disabled workspace;
- viewport engage or disengage;
- dialog, panel, or disclosure context changes; and
- an invalid or removed focused element.

After any clear or context transition, require all mapped controls to report
neutral before re-arming. Connection alone is not intentional activity.
Resting-stick noise must not move focus or engage the viewport.

## Failure Modes

- A virtual mouse makes controller precision the primary interaction and can
  double-trigger controls when focus navigation remains active.
- Letting sticks manipulate the viewport whenever its canvas happens to have
  focus makes UI navigation and camera input ambiguous.
- A hidden parallel controller selection conflicts with DOM focus, keyboard
  users, and assistive technology.
- Linear DOM-order navigation across a three-column editor produces surprising
  jumps that do not match visible direction.
- Wrapping spatial navigation from one edge to an unrelated control destroys
  directional predictability.
- Moving focus automatically authors object selection and confuses focus with
  selection.
- Reusing the confirm press that engaged a viewport as a selection press causes
  accidental edits.
- Frame-dependent camera deltas and transform repeat make controller behavior
  vary with display or rendering performance.
- Device-name parsing mislabels controls, expands fingerprinting exposure, and
  remains brittle across browsers.
- Disabling other input families after controller detection violates
  concurrent-input expectations.

## Validation

1. Pure tests cover standard mapping, two-stick dead zones, trigger
   normalization, neutral arming, edges, directional hysteresis, repeat timing,
   active-controller choice, disconnect, and context clearing.
2. Spatial-navigation tests cover half-plane filtering, alignment, distance,
   logical regions, hidden/inert/disabled exclusion, no multidirectional wrap,
   scrolling, and stable document-order ties.
3. Browser tests cover UI-to-viewport engagement, neutral handoff, camera
   actions, center selection, framing, tool/axis feedback, snapped edit history,
   dialog containment, safe back behavior, and disconnection in both editors.
4. Existing keyboard, pointer, touch, responsive, document, history, access,
   save, publication, and runtime regressions remain green.
5. Representative physical-controller QA covers both editors on desktop,
   including at least one complete navigation and edit path without pointer
   assistance.
6. QA explicitly records where text or precision work still requires another
   input family.

## Primary Sources

- [W3C Gamepad specification](https://www.w3.org/TR/gamepad/)
- [W3C CSS Spatial Navigation Level 1](https://www.w3.org/TR/css-nav-1/)
- [WAI-ARIA Authoring Practices: Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WAI-ARIA Authoring Practices: Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Xbox Accessibility Guideline 107: Input](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107)
- [Xbox Accessibility Guideline 112: UI Navigation](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112)
- [Xbox Accessibility Guideline 113: UI Focus Handling](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/113)
- [Xbox Accessibility Guideline 114: UI Context](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/114)
- [Microsoft gamepad focus engagement](https://learn.microsoft.com/en-us/windows/uwp/ui-input/gamepad-and-remote-interactions)

## Known Limits

- This first standard supports only browser gamepads reported with the
  `standard` mapping.
- Remapping, controller glyph selection, vibration, nonstandard mappings, and
  multiple simultaneous editor operators remain outside PR 3.4.
- Representative controller diversity remains limited until additional
  hardware QA is recorded.
