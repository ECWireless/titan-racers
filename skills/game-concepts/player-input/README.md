# Player Input

**Maturity:** Validated. This standard was researched, implemented, reviewed,
and accepted through keyboard, touch, and physical standard-controller QA for
PR 4A on 2026-07-13.

## Purpose And Scope

This node defines the engine-independent Titan Racers standard for translating
keyboard, touch, and controller interaction into coherent driving and menu
actions. Read it before changing driving bindings, analog response, touch
controls, menu navigation, device arbitration, input cancellation, reset, or
pause input.

It does not own kart force calculations, race lifecycle, checkpoint recovery,
browser APIs, or a particular engine input class. Tool-specific behavior belongs
under [`../../tools/`](../../tools/README.md). Verified repository ownership
belongs under [`../../project-systems/`](../../project-systems/README.md) only
after implementation and acceptance.

## Standard

Treat physical devices as replaceable adapters around one normalized action
contract. Sample that contract at the gameplay fixed-step boundary. Gameplay
systems consume actions and action edges without knowing which device produced
them.

Support concurrent input mechanisms. A detected touch screen or controller must
not disable keyboard access, and a recent keyboard action must not prevent a
player from changing devices without restarting the race.

## Desired Outcome

- Keyboard, touch, and standard-mapped controllers can each drive, recover, and
  pause the same kart.
- Switching devices is predictable and is never triggered by resting-stick
  noise.
- Analog controls retain useful range outside a dead zone; digital controls map
  to the same normalized values.
- Losing focus, cancelling a pointer, disconnecting a controller, pausing, or
  tearing down the scene cannot leave acceleration or steering held.
- Touch controls remain usable with multiple simultaneous fingers, safe-area
  insets, coarse pointers, and narrow supported viewports.
- Device-specific behavior is testable without a physical device, while final
  controller acceptance still includes a real-hardware playthrough when
  available.
- A controller player can enter the race, operate pause/error overlays, resume,
  and exit without switching to a mouse or keyboard.

## Normalized Action Model

Expose continuous action state separately from one-shot requests:

- `steer`: `-1` full left through `0` neutral to `1` full right;
- `accelerate`: `0` released through `1` fully engaged;
- `brakeReverse`: `0` released through `1` fully engaged;
- `handbrake`: `0` released through `1` fully engaged;
- `resetRequested`: one edge for each deliberate reset activation; and
- `pauseRequested`: one edge for each deliberate pause activation.

Clamp all adapter output at the action boundary. Reject non-finite values in
testable normalization helpers. Do not encode device identity, DOM events,
button indexes, or engine objects in the gameplay contract.

Continuous actions describe player intent rather than kart physics. The kart
controller remains responsible for braking to a stop before engaging reverse.
Reset and pause are edges rather than held booleans so a held key or button
cannot repeatedly toggle state or recover the kart every simulation step.

## Sampling And Arbitration

Adapters retain raw device state, but the input coordinator produces one
immutable snapshot immediately before each gameplay physics step.

Use intentional activity to choose the owner of continuous driving actions:

1. A device becomes active when a digital driving control is pressed or an
   analog value crosses the post-dead-zone activity threshold.
2. Resting analog noise and connection events do not take ownership.
3. The most recently intentional active device supplies the complete continuous
   driving vector until another device becomes intentionally active.
4. When the active device disconnects or is cancelled, clear its state before
   another adapter may take ownership.

Treat reset and pause edges independently from continuous ownership. Accept an
edge from any supported device, de-duplicate repeat events within that adapter,
and consume each queued edge once.

This policy avoids combining opposing devices into surprising partial values
while still satisfying the requirement that input mechanisms remain available
concurrently.

## Device Standards

### Keyboard

- Support both WASD and arrow-key driving bindings.
- Bind either physical Shift key to handbrake while driving input is owned.
- Use physical-key codes for the established layout-independent driving
  positions.
- Prevent the page's default arrow behavior only while the race surface owns
  driving input.
- Ignore repeated keydown events for reset and pause edges.
- Key release, focus loss, pause, cancellation, and teardown clear held state.

### Touch

- Use explicit semantic DOM controls rather than interpreting gestures across
  the whole game canvas. Controls may use familiar racing icons instead of
  visible text, but they retain accessible names and state.
- Use a fixed virtual steering pad whose horizontal thumb displacement maps
  continuously to `steer`. The knob recenters on release, pointer cancellation,
  lost capture, pause, focus loss, or teardown.
- Give the steering pad a small center dead zone, clamp travel at the visual
  boundary, and ignore vertical displacement. A two-axis joystick would imply
  driving behavior the kart does not support.
- After the dead zone, apply a bounded response curve that preserves full lock
  at the edge while reducing steering gain near the center. Keep this in the
  touch adapter so keyboard, controller, and kart-physics response do not
  change with touch feel tuning.
- Use separate hold controls for accelerate and brake/reverse. Track each active
  pointer by ID so analog steering and a pedal can be held at the same time and
  one pointer release cannot cancel another control.
- This slice exposes no separate touch handbrake; the continuous brake/reverse
  control can still produce tire slip through the shared physics model.
- Treat pointer up, pointer cancel, lost capture, pause, and teardown as release.
- Apply direct-manipulation suppression only to the control regions that need
  it; do not disable ordinary browser gestures across unrelated UI.
- Give every control an accessible name, visible state, keyboard-operable DOM
  semantics, and a target comfortably larger than the WCAG 2.2 24 CSS-pixel
  minimum. Expose the steering pad as an adjustable value and aim for at least
  44 CSS pixels for primary race controls.
- Respect viewport safe-area insets and avoid covering the central driving
  view, pause control, or critical status presentation.

### Controller

- PR 4A supports controllers exposing the browser's `standard` mapping. Unknown
  mappings remain non-fatal and visibly unsupported rather than relying on
  device-name parsing.
- Poll the current controller snapshot at the gameplay sampling boundary;
  connection events alone are not current input state.
- Use left-stick horizontal for analog steering, standard left/right triggers
  for brake/reverse and accelerate, the west face button for handbrake,
  directional-pad left/right as digital steering alternatives, the south face
  button for reset, and the center-right button for pause.
- Apply a configurable steering dead zone and rescale the remaining magnitude
  back across the usable range. A candidate starting threshold is `0.15`, to be
  tuned through representative hardware rather than treated as universal.
- Prefer the first standard-mapped controller that produces intentional input.
  Retain its browser index until disconnect; multi-controller reassignment is
  outside this first slice.
- Do not require vibration, remapping UI, nonstandard layouts, or controller
  glyph inference in this first slice.

## Controller Menu Navigation

Keep menu actions separate from driving actions so UI polling can continue
while gameplay simulation is paused or absent. For standard-mapped controllers:

- left-stick vertical and D-pad up/down move focus through a linear menu;
- the south face button confirms the focused action;
- the east face button performs the current non-destructive back action; and
- the center-right menu/start button opens or closes the pause menu.

Menu focus is real DOM focus, not a parallel visual-only selection. This keeps
the focused element visible, preserves native button activation, and exposes
the same state to keyboard and assistive-technology users. A menu should focus
its preferred safe/default action when it opens. Linear menus wrap at their
ends; spatial grids require explicit directional neighbors and do not
implicitly wrap.

Support both analog and digital menu movement. Apply entry/release hysteresis
to the stick so center noise cannot navigate, emit one move when a direction is
first engaged, then use a deliberate initial delay and bounded repeat interval
while held. Confirm, back, and menu/start remain edge-triggered. A newly opened
menu must first observe neutral controller state so the button that opened it
cannot immediately close or activate it.

Mouse, touch, and keyboard interaction remain concurrent. Controller focus
movement must not replace native semantic controls, synthesize keyboard events,
or create a canvas-only menu abstraction.

## Cancellation And Lifecycle

Clearing input is a safety operation. Clear every adapter and queued edge when:

- the browser window loses focus;
- the document becomes hidden;
- gameplay pauses or stops accepting driving input;
- a relevant touch pointer is cancelled or loses capture;
- the active controller disconnects; or
- the scene detaches or is destroyed.

Clearing must yield an immediately neutral snapshot and must not manufacture
reset or pause edges. The input system owns release for these events; the
runtime-resilience system owns the broader focus and visibility policy.

## Failure Modes

- Reading DOM or controller state directly inside kart physics couples devices
  to gameplay and makes deterministic tests difficult.
- Adding continuous values from multiple devices lets stick noise weaken or
  reverse deliberate keyboard/touch input.
- Switching active devices on connection or any nonzero axis value allows
  controller drift to steal control.
- Treating reset or pause as held state repeats destructive or toggling actions.
- Relying only on pointer up leaves touch controls stuck after browser gesture
  takeover, capture loss, or interruption.
- Disabling keyboard because touch or a controller exists violates concurrent
  input expectations and makes capability detection a user lockout.
- Device-name heuristics for controller layouts are brittle and privacy-noisy.
- A canvas-wide `touch-action: none` unnecessarily blocks browser interaction
  outside the driving controls.
- Polling menu input only from the paused simulation loop makes the pause menu
  impossible to operate because that loop is intentionally stopped.
- Firing one focus move per render frame makes held sticks skip unpredictably
  across menu items and varies with display refresh rate.
- Maintaining a controller-only selection separate from DOM focus creates
  conflicting visual, keyboard, and assistive-technology states.

## Validation

1. Pure tests cover clamping, non-finite input, dead-zone boundaries, rescaling,
   action-edge consumption, and intentional-activity arbitration.
2. Adapter tests cover key repeat, multi-key opposition, continuous touch
   steering, multi-pointer holds, pointer cancellation/capture loss, standard
   gamepad mapping, drift,
   disconnect, focus loss, visibility loss, pause, and teardown.
3. Fixed-step integration proves each device produces the same normalized kart
   intent and that inactive-device noise cannot steal control.
4. Desktop browser tests drive with keyboard and synthetic standard-gamepad
   snapshots; mobile browser tests drive with simultaneous touch controls.
5. Supported narrow viewports keep controls reachable, non-overlapping, visibly
   active, and clear of safe-area insets.
6. User-facing QA covers keyboard feel, multi-touch comfort, device switching,
   and at least one physical standard-mapped controller when available.
7. Menu tests cover initial neutral arming, stick hysteresis, D-pad movement,
   delayed repeat, confirm/back/menu edges, focus wrapping, pause/resume, and a
   controller-only path from mode selection into and back out of a race.

## Tool Mapping

- [`../../tools/browser-player-input/`](../../tools/browser-player-input/README.md)
  maps this standard to DOM Keyboard Events, Pointer Events, the Gamepad API,
  React controls, and the repository-owned PlayCanvas fixed-step runtime.

## Comparative Touch Layout Research

Established mobile racers do not converge on one control mode: Asphalt exposes
selectable control schemes, Real Racing has offered tilt, touch-zone, wheel,
manual-pedal, and flipped layouts, and Beach Buggy Racing supports touch beside
physical steering and gamepads. The reusable pattern is therefore not one
copied HUD; it is thumb-edge control grouping, low obstruction, recognizable
steering/pedal affordances, and configurable input families.

Titan Racers applies that pattern with an original fixed horizontal steering
pad at lower left, asymmetric pedals at lower right, and compact utilities in
the top corners. Comparative screenshots inform placement only; no external
game art or assets are copied.

## Primary Sources

- [W3C Gamepad specification](https://www.w3.org/TR/gamepad/)
- [W3C Pointer Events Level 4](https://www.w3.org/TR/pointerevents4/)
- [WCAG 2.2 keyboard accessibility and concurrent input](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2 target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [WAI-ARIA Authoring Practices slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)
- [Xbox Accessibility Guideline 107: Input](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107)
- [Xbox Accessibility Guideline 112: UI navigation](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112)
- [WAI-ARIA Authoring Practices keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WAI-ARIA Authoring Practices modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Gameloft Asphalt Legends control selection](https://gameloft.helpshift.com/hc/en/15-asphalt-legends/faq/573-how-can-i-change-the-control-options/)
- [Vector Unit Beach Buggy Racing 2 input families](https://www.vectorunit.com/bbr2tesla)

## Comparative References

- [Real Racing 3 control schemes](https://en.wikipedia.org/wiki/Real_Racing_3#Controls)
- [Beach Buggy Blitz touch-control reference](https://www.mobygames.com/game/70796/beach-buggy-blitz/screenshots/android/758311/)

## Known Limits

- The `1.75` touch steering response curve and `0.08` dead zone are the accepted
  mobile baseline. Additional device diversity may justify a future settings
  surface rather than changing the shared baseline implicitly.
- The custom slider-style steering pad requires representative touch assistive-
  technology testing; WAI-ARIA notes that synthesized slider key gestures are
  not uniformly implemented across touch screen readers.
- PR 4A does not add remapping, rebinding persistence, controller glyphs,
  vibration, motion controls, nonstandard controller profiles, or controller
  navigation for the protected course-authoring tool.
- Race-state gating and recovery policy are implemented by the validated race
  progression system, which consumes normalized reset and pause requests.
