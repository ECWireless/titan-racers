# Player Input System

## Status

**Maturity:** Validated. PR 4A implementation, static checks, production build,
adapter/browser tests, responsive visual inspection, required independent
review, and feature-lead keyboard/touch/physical-controller acceptance pass as
of 2026-07-13.

## Purpose And Scope

This node documents the implemented Titan Racers player-input foundation. It
combines the engine-independent
[`player-input`](../../game-concepts/player-input/README.md) standard with the
browser and PlayCanvas mapping in
[`browser-player-input`](../../tools/browser-player-input/README.md).

The system owns normalized keyboard, touch, and early controller input,
intentional-activity arbitration, fixed-step sampling, input cancellation,
one-shot reset and pause requests, accessible touch-driving controls, and
controller navigation through guest-play menus and race overlays.

Race countdowns, progression, checkpoint recovery, lap timing, and finish state
are owned by the separate
[`race-progression`](../race-progression/README.md) system. Integrated HUD,
finish, and replay behavior are owned by
[`race-presentation`](../race-presentation/README.md). Kart force calculations
remain owned by the kart-physics system.

## Source Ownership

- `src/game/contracts.ts` defines the plain normalized `PlayerInputActions`
  contract while retaining the established kart-controller `DrivingInput`
  boundary.
- `src/game/input/player-input.ts` owns clamping, dead-zone rescaling, neutral
  values, the device/source types, and the explicit sign conversion into the
  accepted kart-controller steering convention.
- `src/game/input/keyboard-input.ts` owns WASD/arrow driving state, either Shift
  key as the held handbrake, and one-shot R reset and Escape pause edges.
- `src/game/input/touch-input.ts` owns a continuous pointer-specific steering
  value with a rescaled `0.08` dead zone and touch-only `1.75` response exponent,
  independent pedal-pointer state, and reset request state.
- `src/game/input/gamepad-input.ts` polls browser snapshots, accepts only the
  standard mapping, applies the `0.15` candidate steering dead zone, maps the
  left stick/D-pad/triggers/west/south/center-right controls, maps west-face
  button 2 to handbrake, detects reset/pause edges, retains the first
  intentionally active controller until disconnect, and requires a neutral
  release before input can re-arm after clearing.
- `src/game/input/gamepad-menu-input.ts` owns controller UI neutral arming,
  vertical-stick hysteresis, D-pad movement, delayed hold repeat, and
  confirm/back/menu edge detection independently of gameplay sampling.
- `src/game/input/use-controller-menu-navigation.ts` polls menu input with
  `requestAnimationFrame`, maps it to DOM focus and native activation, provides
  linear wrapping and explicit controller-focus presentation, and clears on
  blur, hidden visibility, disable, and unmount.
- `src/game/input/player-input-manager.ts` owns device-family arbitration,
  action-edge aggregation, and conversion to existing kart driving intent.
- `src/components/solo-time-trial-canvas.tsx` attaches the manager, samples once
  before each 60 Hz physics step, applies reset/pause requests, clears input at
  lifecycle boundaries, renders touch controls without using React state as
  physics input, and scopes controller navigation to loading/error, pause, and
  finish overlays.
- `src/components/play-home.tsx` scopes controller focus and activation to the
  guest mode-selection actions without extending navigation into the protected
  course editor.
- `src/app/globals.css` owns the low-obstruction racing HUD, coarse-pointer
  visibility, safe touch target sizing, steering/pedal engagement feedback,
  direct-manipulation suppression, compact landscape sizing, and a guaranteed
  visible outline for programmatically focused controller-menu actions.
- `src/game/testing/scene-test-adapter.ts` retains a semantic non-production
  direct reset hook for deterministic paused physics fixtures; live input tests
  use the public keyboard, touch, and injected browser-gamepad boundaries.
- `tests/player-input.spec.ts` covers normalization, dead zones, mappings,
  edges, multi-pointer state, unsupported controllers, idle-controller
  selection, device-family arbitration, menu neutral arming, stick hysteresis,
  D-pad movement, and bounded repeat.
- `tests/home.spec.ts` covers keyboard, touch, and controller driving/reset,
  touch cancellation, touch target size, controller pause, controller-only menu
  entry/resume/back/exit, and all retained physics/camera/collision behavior.

## Runtime Flow

1. Keyboard events update held keys and queue reset/pause edges. The touch
   steering pad maps horizontal pointer displacement continuously while touch
   pedal events update pointer-specific holds. The gamepad adapter polls the
   latest browser snapshots during sampling.
2. A digital press or meaningful post-dead-zone analog change marks that device
   family intentionally active. Connection and resting-stick noise do not.
3. Immediately before a fixed physics step, the manager samples all adapters.
   The active family supplies the complete continuous driving vector; reset and
   pause edges are accepted from every family.
4. The normalized vector is clamped and mapped to the existing kart controller.
   The player contract follows the standard gamepad axis sign, while the mapping
   deliberately inverts steering for the accepted legacy kart convention.
5. Reset snaps the kart through the existing reset system and clears retained
   input. Pause disables and clears input, pauses the owned runtime clock, and
   opens the accessible pause dialog. Resume requires a neutral controller
   sample and fresh activation.
6. PlayCanvas advances the Ammo world once. The same sampled driving input is
   retained for the controller's post-step update.

Controller menus use a separate frame-polled path because the home screen has
no gameplay runtime and the fixed-step clock intentionally stops while paused.
That path begins disarmed until neutral, finds standard-mapped controller UI
intent, and moves actual DOM focus through the current menu scope. The south
face button invokes the focused element's native click, the east face button
performs the scoped back action, and menu/start toggles pause where applicable.
It never writes driving state or synthesizes keyboard events.

## Touch Presentation

The race HUD exposes a fixed analog steering pad at the lower left, accelerator
and brake/reverse pedals at the lower right, and compact reset/pause utilities
in the top corners on coarse/no-hover devices. Original inline SVG glyphs
replace visible text while native or ARIA semantics retain accessible names.
Primary controls remain at least 44 CSS pixels in portrait and compact landscape.

The pad maps horizontal travel to `-1..1`, applies the touch adapter's `0.08`
dead zone, then raises the remaining magnitude to the `1.75` power. This
touch-only curve reduces gain near center while preserving sign and full lock
at the edge. The control clamps the knob at the visual boundary, ignores
vertical motion, and recenters on release. It exposes horizontal slider
semantics and arrow-key operation. Pedals retain native button semantics,
`aria-pressed`, and Space or Enter hold/release behavior.

Only driving controls use `touch-action: none`. Each control captures and tracks
its pointer ID, so analog steering and acceleration/braking coexist and one
pointer release does not clear another. Pointer up, pointer cancel, lost
capture, blur, hidden visibility, pause, reset, and teardown release retained
state and presentation.

## Controller Contract

PR 4A supports one active browser controller with `mapping === "standard"`:

- axis 0: steering, with a rescaled `0.15` axial dead zone;
- buttons 14/15: digital steering fallback;
- button 6: brake/reverse;
- button 7: accelerate;
- button 2: handbrake;
- button 0: reset; and
- button 9: pause.

While a guest-play menu or race overlay owns controller UI input:

- axis 1 and buttons 12/13: vertical focus movement with linear wrapping;
- button 0: confirm the focused action;
- button 1: non-destructive back; and
- button 9: pause/resume.

Analog menu movement enters at `0.55`, releases below `0.35`, fires once
immediately, waits `350 ms`, then repeats no faster than every `120 ms`.
Opening a new menu requires a neutral controller observation before held input
can activate it.

An earlier connected but idle controller cannot block a later controller that
produces intentional input. Once selected, the active index remains stable
until disconnect. Nonstandard mappings remain neutral and non-fatal.

## Accepted Invariants

- Gameplay consumes plain normalized values and action edges, never DOM,
  React, PlayCanvas input wrappers, or browser `Gamepad` objects.
- Sampling happens before kart update and Ammo world advance at the existing
  60 Hz fixed-step boundary.
- One device family owns the complete continuous vector; values from multiple
  devices are never added together.
- Reset and pause edges are consumed once and ignore keyboard repeat or held
  controller buttons.
- Focus/visibility loss, pause, controller disconnect, pointer cancellation,
  reset, and teardown yield neutral retained input without manufacturing
  actions. A cleared controller must return fully neutral before it can re-arm.
- DOM touch presentation reflects adapter updates but is not authoritative
  physics input and does not rerender React for continuous pointer motion.
- Keyboard, touch, or controller detection never disables another supported
  input family.
- No controller ID or device-name value enters analytics, persistence, UI, or
  other application state.
- Controller menu selection is browser DOM focus. It shares native semantic
  controls with keyboard, pointer, and assistive-technology input rather than
  maintaining a controller-only parallel selection.
- Menu polling does not depend on the gameplay fixed-step clock and cannot
  mutate kart driving input while an overlay owns focus.

## Verification

- `pnpm typecheck` and `pnpm lint` pass.
- `pnpm build` passes; Turbopack requires the established unsandboxed build
  allowance because its CSS worker binds an internal port.
- `tests/player-input.spec.ts`: fifteen focused normalization, adapter, edge,
  controller-selection, arbitration, menu arming, hysteresis, repeat, and
  disconnect/re-arm cases pass.
- Focused desktop Chromium controller scenarios pass together: continuous
  driving/reset/pause and a controller-only path through mode selection, pause
  focus wrapping, A confirm, B resume, Start pause, and Exit back to the home
  screen.
- Four focused controller UI scenarios pass together for visible default pause
  focus, initializing-state Exit, failed-state Reload, focused failed-state
  Exit, failed-state Back, and neutral setup across those transitions.
- Focused `tests/home.spec.ts` mobile analog steering/pedal and desktop
  continuous-controller scenarios pass, including captured drag, clamping,
  pointer cancellation/capture loss, recentering, and neutral re-arming.
- The complete `pnpm test:e2e` desktop/mobile matrix passes 250 cases and skips
  52 by project/environment design. This includes every new input adapter,
  touch-driving, controller gameplay, controller-menu, and retained gameplay
  regression case.
- Mutable guest publication data is isolated from the collision and ramp
  diagnostics that assert exact bundled-course geometry. The ramp diagnostic
  retains its original physics threshold with a 60-second diagnostic budget;
  its focused desktop/mobile run and the complete matrix pass.
- Pixel 7 portrait, compact landscape, and engaged-state browser inspection
  confirms clear central gameplay view, safe-area placement, separated thumb
  groups, continuous knob travel, and visible pedal/steering feedback. The
  Next.js development indicator can overlay the lower-left pad in development
  only.
- One fresh-context technical/gameplay/experience reviewer reported two P1
  lifecycle/arbitration findings and one P2 accessibility finding. Neutral
  controller re-arming, stable gradual-analog activation baselines, and
  Space/Enter touch-control semantics resolved them; the same reviewer cleared
  all three in focused re-review with no remaining actionable issue.
- A second fresh-context review of the analog redesign found two P2 coverage
  gaps. Captured drag/cancellation coverage and complete brake-trigger/D-pad
  mapping assertions resolved them; focused re-review cleared both with no
  remaining actionable issue.
- A fresh-context controller-menu review found two P2 presentation/coverage
  gaps. Guaranteed visible default focus plus controller-driven loading/error
  cases resolved them; the same reviewer cleared both with no remaining issue.

## Known Limits

- A FlyDigi Vader 4 over USB in Chrome on macOS completed the representative
  controller gameplay and menu acceptance pass. Additional controller models,
  operating systems, wireless transports, latency, and dead-zone feel remain
  unverified.
- PR 4A intentionally omits remapping, binding persistence, controller glyphs,
  vibration, motion control, nonstandard mappings, and multi-controller
  reassignment while an active controller remains connected.
- Controller menu navigation is deliberately limited to guest mode selection
  and race loading/error/pause/finish overlays. The protected course editor
  remains a keyboard, pointer, and touch authoring surface in this slice.
- The `1.75` touch steering exponent and `0.08` dead zone are the accepted mobile
  baseline. Additional device diversity may justify future control settings;
  visual opacity and pedal spacing remain tunable presentation values.
- Touch controls are visible through coarse-pointer/no-hover capability queries;
  a future settings surface may add a manual visibility preference if hybrid
  hardware proves it necessary.
- The runtime-resilience system owns broader focus, visibility, resize,
  lower-frame-rate, and runtime-failure policy beyond input clearing.
