# Browser Race Presentation

**Maturity:** Validated (PR 2.4.3, 2026-07-13).

## Purpose And Scope

This node maps the engine-independent
[`race-presentation`](../../game-concepts/race-presentation/README.md) standard
to React 19, semantic HTML, CSS, the repository-owned PlayCanvas runtime, and
the existing controller-menu adapter.

## Ownership Boundary

`RaceSession` remains the only race authority. A pure TypeScript projector
accepts defensive race snapshots and the most recent progression result. It
returns formatted plain data with no React, DOM,
PlayCanvas, Ammo, timers, or mutable engine objects.

The PlayCanvas integration publishes that projection after fixed steps and
renders, but updates React only when a projected value changes. Live timing is
therefore bounded to its displayed tenth instead of producing 60 React updates
per second.

## DOM And Focus Mapping

- Use a labelled semantic region for persistent lap and time status.
- Keep the live-region node mounted and update only its meaningful announcement
  string.
- Retain lap and incomplete-route announcement events until later meaningful
  progression replaces them, so fixed-step batching cannot erase them before a
  browser accessibility tree observes the change.
- Mark lifecycle cues visual-only when the same change is already announced.
- Make the finished canvas inert and disable gameplay input.
- Render finish as a labelled modal dialog containing native buttons and list
  semantics for lap results.
- Reuse DOM-focus controller navigation; require a neutral controller sample
  before confirm can activate the default replay button.
- On replay, reset the authoritative session and kart, clear retained input,
  restore the countdown projection, and focus the canvas.
- If pause and finish arrive on one fixed step, apply pause presentation only
  when the authoritative session accepts the pause transition; finish wins.

## CSS Mapping

Use one compact, clipped technical instrument containing lap and race time with
stable tabular values. The plate combines the established hazard orange, warm
ice, rust, black-panel, monospace, and industrial-corner language. Reserve
touch-utility space with safe-area-aware padding and simplify dimensions below
400 CSS pixels without removing essential labels or values.

Compact landscape reduces padding and panel height without moving controls into
the central view. Countdown, start, and lap cues remain pointer-transparent.
Start and lap changes use a brief entrance, readable hold, and exit animation;
the animation is removed under `prefers-reduced-motion`. Recovery retains a
meaningful live-region announcement without exposing its internal state label
as visual UI.

## Verification

- Pure projection and restart tests: `tests/race-presentation.spec.ts`,
  `tests/race-session.spec.ts`.
- Browser coverage: two-lap finish, durable announcements, same-step
  pause/finish arbitration, controller replay and exit, and a 350 px HUD that
  clears touch utilities.
- Bundled-course fixtures never consume mutable publication data; publication
  tests use explicit route overrides.

## Known Limits

- React DOM is not a full game-screen narration system. A future accessibility
  settings phase should test representative screen readers and audio-channel
  alternatives separately.
- CSS safe-area behavior is covered through browser layout evidence; physical
  notched-device QA remains valuable.
