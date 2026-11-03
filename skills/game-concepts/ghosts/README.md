# Ghosts

**Maturity:** Validated (PRs 5.1–5.5, 2026-11-03).

## Purpose And Scope

This node defines the engine-independent standard for recording a race and
replaying it as a ghost to race against. Read it before changing how races
are recorded, how ghosts are drawn, or what a recording may prove.

It does not own race timing or gate acceptance
([race progression](../race-progression/README.md)), result storage,
leaderboards, or sharing.

## Standard

- **Record poses, replay them.** Sample the kart's pose at a fixed cadence of
  competitive race time, never wall time or frames, and replay the samples.
  Re-simulating recorded inputs needs bit-identical physics on every browser
  and a second simulation every frame; neither holds on phones.
- **Sample the events exactly.** Add samples on both sides of every gate
  crossing, so the crossing segment can be re-checked, and on the first step
  after a reset, so playback never blends across the teleport. The final
  sample carries the official finish time.
- **One recording, two uses.** The same bytes draw the ghost and serve as the
  evidence a server re-checks a run against. Decoding is strict and bounded,
  since recordings arrive from untrusted clients.
- **Play it on the race clock.** The ghost waits at its first sample through
  the countdown, follows race time (stopping with pauses), is drawn at the
  same moment of race time as the kart, and leaves at its finish.
- **One ghost at a time,** clearly not a kart: see-through, no collision,
  sound, or shadow. Hide it only where it would sit on the kart and fight it
  for the same pixels, with hysteresis so a close race does not make it
  blink; karts that merely touch or overlap stay visible.
- **A ghost belongs to what it raced.** Keep a best per course revision and
  physics version, since a different course or physics makes it a different
  race.

## Failure Modes

- Wall-clock or frame-indexed samples drift with pauses, stalls, and frame
  rate.
- Blending across a reset smears the ghost through walls.
- Blended transparency on a many-part model sorts wrongly and flickers.
- Hiding the ghost whenever it is near the kart makes it vanish in the
  closest, most useful moments.

## Validation

- Round-trip and strict-rejection tests for the format.
- Playback tests for steady motion, uneven samples, resets, and rewind.
- A recorded race decodes with one gate sample per crossing and ends on the
  official time.
- Renders checked by eye in every lighting the course has.

## Related

- [Ghost system](../../project-systems/ghosts/README.md)
