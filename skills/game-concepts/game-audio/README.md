# Game Audio

**Maturity:** Candidate (PR 4.5.1, 2026-11-01).

## Purpose And Scope

The engine-independent standard for race sound: what the player should hear,
how sound relates to the simulation, and how it follows the game's lifecycle.
Read it before adding or changing any sound, mix level, or audio lifecycle
rule.

## Standard

Race sound is presentation. It is derived from simulation results each frame
and never feeds back into physics, timing, or race state. Each sound follows a
physical source the player can see or infer: the kart's motor and tires, what
it hits, and the places it drives through.

## Desired Outcome

- The player hears the kart they drive: motor strain under load, the surface
  under each tire, hits and landings, in proportion to what happened.
- Sound is scaled to the objects: a 1:10 RC kart sounds like a real one
  (brushless whine, light clacks), while the world around it sounds full-size.
- Sound never plays when the game is not visibly running, and a muted game
  does no audio processing.

## Core Principles

- **Realism over exaggeration.** Recipes come from how the real object
  makes sound, not from arcade conventions. Do not imitate a specific game's
  or brand's sounds.
- **Readable on phone speakers.** Phones reproduce little below about 150 Hz,
  so cues that must read carry energy between about 500 Hz and 4 kHz.
- **Comfortable over a whole race.** A sound the player hears all the time,
  like the motor, keeps little energy above about 4 kHz, even where the real
  machine is shriller. Realism yields to fatigue here.
- **What is behind a surface sets its ring.** Boards with soil behind them,
  posts in footings, and full drums knock dully; only free-standing,
  unbacked objects ring.
- **One-way mapping.** A pure mapping turns state into sound parameters and
  is testable without audio hardware. The voices only render those
  parameters.
- **Continuous state stays continuous.** A sound's parameters follow the
  physical quantity's own time scale, such as wheelspin recovering under grip,
  rather than jumping when the state that drives them changes.
- **Budgeted voices.** Each voice has a fixed node count and per-event cost,
  so adding karts or sources scales predictably.
- **Lifecycle follows the game.** Audio starts from a user gesture, and stops
  whenever the game is paused, covered, unfocused, hidden, or exited. Muting
  is a remembered player choice.
- **Loudness, not peak, sets the mix.** Compare and balance sounds on
  short-window loudness, with a limiter only as protection.

## Failure Modes

- A pitched oscillator as the body of an impact reads as a synth drum.
- One filtered noise burst for every hit erases material identity.
- Louder candidates win comparisons unless loudness is matched first.
- Audio that keeps running behind a pause or hidden tab, or starts before a
  gesture, breaks trust and triggers browser autoplay blocks.

## Validation

- Unit specs for the mapping from simulation state to sound parameters.
- A browser test of start, pause, and mute persistence across a reload.
- Blind, loudness-matched listening on the target phone and on headphones.

## Related Nodes

- [`browser-web-audio`](../../tools/browser-web-audio/README.md): the
  browser mapping.
- [`kart-physics`](../kart-physics/README.md): the motor and tire behavior
  that sound follows.
- [`runtime-resilience`](../runtime-resilience/README.md): the pause, blur,
  and hidden-tab lifecycle that sound follows.

## Sources

- The repository's [`IMPLEMENTATION_PLAN.md`](../../../IMPLEMENTATION_PLAN.md)
  (PR 4.5).
