# Race Presentation

**Maturity:** Validated. PR 2.4.3 implementation, feature-lead presentation/feel
acceptance, complete automated regression, and fresh-context independent review
are complete as of 2026-07-13.

## Purpose And Scope

This node defines the engine-independent Titan Racers standard for presenting
countdown, race time, ordered progress, laps, recovery, and finish results. Read
it before changing the in-race HUD, lifecycle cues, finish flow, or race-state
announcements.

It does not own lifecycle authority, checkpoint acceptance, device bindings,
kart physics, persisted results, ghosts, leaderboards, telemetry, or final
course art. Those systems supply state; presentation makes that state legible.

## Standard

Project one authoritative race snapshot into a small presentation model. Keep
competitive time, lifecycle transitions, and progress out of the UI layer.

Display only the persistent information needed while driving:

- current lap and total laps; and
- elapsed competitive time.

Ordered gates are invisible route-validation infrastructure in the rough loop,
not player objectives. Do not expose a gate counter or routine checkpoint
notifications. If invalid route progression prevents a lap from completing,
communicate the player-relevant outcome without exposing internal gate IDs.

Use a central cue for the short countdown, race start, and new lap. Recovery is
already legible through the kart reposition and should not expose an internal
state label as visual UI. The cue supplements rather than replaces the
persistent HUD. Finish moves to a focused results context with total time,
per-lap times, replay, and exit.

## Readability And Layout

- Keep persistent status near the top edge and the central racing line clear.
- Use high-contrast backing behind text because the course background changes.
- Use tabular numerals and stable widths so timing updates do not make the HUD
  jump.
- Reflow or simplify labels on narrow screens instead of shrinking essential
  values below a legible size.
- Respect safe-area insets and reserve space for touch reset, pause, steering,
  and pedals.
- Keep the same information hierarchy across keyboard, touch, and controller.
  Device availability must not produce different race knowledge.

## Assistive-Technology Contract

Expose the persistent HUD as one named status region. Announce only meaningful
changes such as countdown seconds, race start, new laps, recovery, an incomplete
lap route, and finish. Do not announce a continuously
updating timer: over-frequent live-region changes make the race unusably chatty.

The finish result is a change of context, so use a labelled dialog, move DOM
focus to the safe default replay action, trap keyboard focus within it, and use
the same semantic buttons for pointer, keyboard, touch, and controller menu
input.

Visual cues must not depend on flashing. Color may reinforce state but cannot be
its only carrier.

## Timing Projection

Format elapsed time downstream from deterministic integer microseconds. Live
timing may display tenths to limit layout and render churn; final and lap times
display milliseconds. Truncate the displayed fraction rather than rounding
ahead of authoritative time.

The UI may update only when its formatted projection changes. It must not copy
the fixed-step simulation rate into React rendering or reconstruct time from
wall-clock reads.

## Validation

1. Pure tests cover time formatting and every lifecycle/progression projection.
2. Browser tests cover countdown, lap changes, recovery, finish, replay,
   live-region behavior, and keyboard/controller focus.
3. Desktop, narrow portrait, and compact landscape inspection proves readable
   hierarchy, safe-area handling, and no control overlap.
4. Full keyboard, multi-touch, and physical standard-controller playthroughs
   prove the same race knowledge and finish path are available to each family.
5. Runtime tests confirm UI updates cannot mutate lifecycle or timing authority.

## Failure Modes

- Recomputing time in React creates a second race clock.
- Announcing timer tenths overwhelms screen-reader users.
- Exposing internal checkpoint counts adds noise without helping players follow
  a course whose gates are intentionally invisible.
- Letting the HUD cover thumb zones or the driving line makes mobile play worse.
- A visual-only canvas finish state strands keyboard and controller players.
- Rounding the visible clock ahead can disagree with final results.

## Tool Mapping

- [`../../tools/browser-race-presentation/`](../../tools/browser-race-presentation/README.md)
  maps this standard to React, semantic DOM, CSS safe areas, and the owned
  PlayCanvas runtime boundary.

## Primary Sources

- [Xbox Accessibility Guideline 101: Text display](https://learn.microsoft.com/gaming/accessibility/xbox-accessibility-guidelines/101)
- [Xbox Accessibility Guideline 112: UI navigation](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112)
- [Xbox Accessibility Guideline 116: Time limits](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/116)
- [W3C Understanding WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Known Limits

- PR 2.4.3 does not add configurable HUD scale, contrast themes, audio cues,
  screen-reader narration settings, split comparison, minimaps, or wayfinding.
- The rough course has no final art, so later environments require renewed
  contrast and obstruction inspection.
