# Browser Player Input

**Maturity:** Validated. This mapping was researched against current browser
standards and PlayCanvas Engine `2.20.6`, implemented, reviewed, and accepted
through automated plus representative-device QA for PR 4A on 2026-07-13.

## Purpose And Scope

This node maps the engine-independent
[`player-input`](../../game-concepts/player-input/README.md) standard to browser
Keyboard Events, Pointer Events, the Gamepad API, React DOM controls, browser
focus, and Titan Racers' owned fixed-step PlayCanvas runtime.

Read it before implementing or diagnosing keyboard, touch, or controller input.
It does not own kart physics, race progression, or the final repository source
layout; verified implementation truth belongs under
[`../../project-systems/`](../../project-systems/README.md).

## Tool Boundary

Use browser input APIs directly for PR 4A rather than enabling PlayCanvas input
device wrappers:

- the existing race shell already owns keyboard listeners outside PlayCanvas;
- touch controls are accessible React DOM elements layered over the canvas;
- the Gamepad API must be polled for current state;
- the repository owns the animation-frame and 60 Hz fixed-step order; and
- device adapters must be unit-testable without constructing a PlayCanvas
  application.

PlayCanvas `2.20.6` can accept `Keyboard`, `TouchDevice`, and `GamePads` in its
application options. Its `Application.update()` also updates connected input
devices. That lifecycle is unnecessary here and would put PlayCanvas-maintained
input state on the wrong side of the repository's explicit pre-physics sampling
boundary. Keep normalized browser values as plain TypeScript data and pass only
the resulting driving intent to kart gameplay.

## Keyboard Mapping

- Listen on `window` for `keydown` and `keyup` while the mounted race owns the
  controls.
- Bind `KeyboardEvent.code` values `KeyW`, `KeyA`, `KeyS`, `KeyD`, and the four
  arrow codes to established physical driving positions.
- Bind `ShiftLeft` and `ShiftRight` to the continuous handbrake action.
- Bind `KeyR` to reset and `Escape` to pause without accepting repeated keydown
  events as new action edges.
- During handling polish, bind an unmodified `KeyT` outside the gameplay input
  adapter to toggle the session-only tuning surface. Ignore it for editable
  targets, modified key combinations, pause, finish, and repeated keydown.
- Call `preventDefault()` only for handled input while gameplay owns it.
- When a native input, select, textarea, or editable element has focus, leave
  handled keys to that control and do not manufacture driving, reset, or pause
  intent. A keyup may still clear previously retained driving state.
- Clear the adapter on blur, hidden visibility, pause, and detach.

The adapter should expose state reads and edge consumption without importing
PlayCanvas or React.

## Pointer And React Mapping

Render a labelled two-axis drive joystick plus `button` elements for accelerate
and brake/reverse. React owns presentation and pointer geometry; a plain touch
adapter owns pointer IDs and normalized state.

- On joystick `pointerdown`, register the pointer ID, request capture, and map
  displacement from the fixed pad center into a two-axis vector. Horizontal
  input supplies steering; upward input supplies acceleration; downward input
  supplies brake/reverse. Update on captured `pointermove` and recenter on every
  terminal path.
- Clamp the knob to the pad's circular travel limit. Apply the accepted radial
  dead zone and bounded response exponent to vector magnitude while preserving
  direction, zero, monotonicity, and full authority at the rim.
- On pedal `pointerdown`, register the pointer ID for that action and request
  pointer capture from the button.
- On `pointerup`, `pointercancel`, or `lostpointercapture`, release only that
  pointer's action.
- Permit multiple pointer IDs so joystick and pedal input work
  together.
- Use `touch-action: none` and selection suppression on the driving controls,
  not the full canvas or page.
- Do not infer release from pointer position leaving the element after capture.
- Release all pointers on pause, hidden visibility, blur, unmount, or scene
  teardown.
- Expose the joystick as a labelled two-axis group with concise instructions
  and four-arrow keyboard operation rather than invalid one-axis slider state.
  Use `aria-pressed` when a pedal is active, while retaining visible engaged
  treatments for both joystick and pedals.

Pointer capture retargets subsequent pointer events until release, while the
browser can still end the stream with `pointercancel` or lost capture. Handle
all terminal paths explicitly.

## Gamepad Mapping

Listen for `gamepadconnected` and `gamepaddisconnected` to maintain connection
awareness, but read `navigator.getGamepads()` at each fixed-step input sample.
Browsers may expose a controller only after the player interacts with it.

For a gamepad whose `mapping` is `standard`, use the standard indices:

| Action        | Standard control           |         Index |
| ------------- | -------------------------- | ------------: |
| Steer         | Left-stick horizontal axis |        axis 0 |
| Digital steer | D-pad left/right           | buttons 14/15 |
| Brake/reverse | Left trigger               |      button 6 |
| Accelerate    | Right trigger              |      button 7 |
| Handbrake     | West face button           |      button 2 |
| Reset         | South face button          |      button 0 |
| Pause         | Center-right button        |      button 9 |

Use `GamepadButton.value` for analog triggers and fall back to `pressed` as
`1` when needed. Clamp axes and button values before normalization. Apply a
symmetric axial steering dead zone, then rescale the magnitude outside it:

`sign(value) * (abs(value) - deadZone) / (1 - deadZone)`

Return zero inside the dead zone. Clamp the result after rescaling. Edge-detect
reset and pause against the prior polled snapshot; connection events never
create action edges.

Gamepad objects are browser snapshots and may be replaced or updated between
polls. Retain only plain prior button state and the active browser index, not a
long-lived assumption that one `Gamepad` object remains current.

Choose the first connected standard-mapped controller that produces intentional
input, then retain its index until disconnect. Do not let an earlier connected
but idle controller prevent a later controller from becoming active.

## Controller Menu Mapping

Poll controller menus from `requestAnimationFrame`, independently of the fixed
physics clock, because the home screen has no gameplay runtime and pausing stops
fixed-step callbacks. Keep the poller as a plain class with injected
`getGamepads` and time dependencies; a small React hook may own its animation
frame and translate emitted actions into DOM focus/click operations.

For the standard layout use axis 1 and buttons 12/13 for vertical movement,
button 0 for confirm, button 1 for back, and button 9 for menu/start. Use a
larger stick entry threshold than the driving dead zone and a lower release
threshold to provide hysteresis. Emit an immediate first move, wait roughly a
third of a second, then repeat at a bounded interval independent of frame rate.

When enabled, the poller begins disarmed and waits until all mapped controls are
neutral. Disable/enable, blur, hidden visibility, disconnect, and unmount reset
that arming and every prior button/direction edge. This prevents the Start press
that opened a dialog or the A press that changed screens from leaking into the
new UI context.

Use native DOM focus as the controller selection model:

1. query enabled, rendered buttons and links inside the current menu scope;
2. retain the active element when it belongs to that scope, otherwise choose
   the declared default or first eligible control;
3. move through linear controls in DOM/visual order with end wrapping; and
4. activate the focused element through its native `click()` method.

Do not dispatch synthetic keyboard events. Keyboard Tab/Enter/Escape behavior,
dialog focus trapping, pointer activation, and assistive technology should
continue using the semantic DOM controls directly.

## Fixed-Step Integration

The coordinator samples adapters in the runtime's existing `onFixedStep`
listener before `DynamicKartController.update()` and before PlayCanvas advances
the Ammo world. Sampling once per physics step gives gameplay one coherent
snapshot and keeps controller polling aligned with the action actually applied.

Render-frame React updates may display active controls or the most recent input
family, but React state must not become the physics input source. Do not publish
per-step input through React state.

Pausing must clear adapters before calling the runtime pause operation. Resume
begins neutral and requires fresh player input. Scene cleanup removes every
listener and clears all retained device and pointer state.

## Testing Method

- Construct keyboard and touch adapters with event-target dependencies rather
  than the global browser where practical.
- Inject a `getGamepads` function into the gamepad adapter so unit and browser
  fixtures can supply deterministic standard-mapped snapshots.
- Test dead-zone math and coordinator arbitration as pure functions/classes.
- Keep non-production browser hooks semantic: set synthetic device snapshots or
  inspect normalized actions, never reach into private DOM or PlayCanvas state.
- Use Playwright pointer events for simultaneous mobile holds and deterministic
  injected gamepad snapshots for browser integration.
- Unit-test the menu poller with an injected clock so stick hysteresis and
  delayed repeat are deterministic. Browser tests should inject standard
  gamepad snapshots and assert actual DOM focus and activation across screens.
- Treat a physical-controller playthrough as user-facing QA, not as a substitute
  for deterministic automated coverage.

## Primary Sources

- [W3C Gamepad specification and standard layout](https://www.w3.org/TR/gamepad/)
- [MDN Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
- [W3C Pointer Events Level 4](https://www.w3.org/TR/pointerevents4/)
- [WAI-ARIA Authoring Practices slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)
- [Xbox Accessibility Guideline 107: Input](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107)
- [Xbox Accessibility Guideline 112: UI navigation](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112)
- [WAI-ARIA Authoring Practices keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WAI-ARIA Authoring Practices modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [PlayCanvas Engine 2.20.6 `AppBase`](https://api.playcanvas.com/engine/classes/AppBase.html)
- [PlayCanvas Engine 2.20.6 API input classes](https://api.playcanvas.com/engine/)

## Known Limits

- Browser and operating-system controller mappings can vary despite the
  standard layout. PR 4A deliberately rejects nonstandard mappings instead of
  guessing.
- Gamepad access may be affected by browser security, user activation, and
  permissions policy. Guest play must remain functional with keyboard and
  touch when no controller is exposed.
- Synthetic controller snapshots verify mapping and lifecycle behavior but not
  physical ergonomics, platform-specific latency, or hardware dead zones.
- The custom two-axis touch joystick requires representative screen-reader QA;
  labelled group semantics, instructions, arrow-key operation, and native pedal
  alternatives do not prove every touch assistive technology can operate it.
- Input-related clearing on focus and visibility changes belongs here; broader
  lifecycle response and bounded health reporting are implemented by the
  [`runtime-resilience`](../../project-systems/runtime-resilience/README.md) and
  [`gameplay-telemetry`](../../project-systems/gameplay-telemetry/README.md)
  systems.
- PR 4A menu navigation covers guest-play mode selection and race overlays, not
  the protected course editor or a general spatial-navigation engine.
