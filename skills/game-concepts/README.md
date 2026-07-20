# Game Concepts

This branch defines Titan Racers' engine-independent, best-supported standards for game behavior and development methods. It describes the result an implementation should achieve before choosing a particular engine, library, or code structure.

## Read This Branch When

- defining how a player-facing mechanic should feel,
- choosing a conceptual model for a game system,
- comparing implementation approaches across tools,
- writing acceptance criteria for gameplay behavior,
- reviewing whether an implementation meets the intended standard.

## Guidance Contract

A game-concept node should normally cover:

1. **Standard:** the current recommended method.
2. **Desired outcome:** what the player or development team should experience.
3. **Core principles:** rules that should survive implementation changes.
4. **Recommended model:** mechanics, algorithms, or workflow at an engine-independent level.
5. **Failure modes:** common weak approaches and why they fail.
6. **Validation:** evidence that demonstrates the standard has been met.
7. **Tool mappings:** links to relevant implementation guidance under `../tools/`.
8. **Maturity:** `exploratory`, `candidate`, or `validated` when useful.
9. **Sources:** project evidence or primary references supporting the guidance.

"Best-supported standard" means the repository's current gold-standard recommendation, not a claim of universal or permanent correctness. Improve the standard when stronger evidence emerges.

## Current Children

- [`kart-assembly/`](kart-assembly/README.md): the candidate standard for
  bounded component assembly, deterministic physical-profile derivation, and
  construction-owned handling differences without stat overrides.
- [`runtime-resilience/`](runtime-resilience/README.md): the accepted
  engine-independent standard for safe lifecycle interruption, bounded
  fixed-step degradation, resize recovery, loading exits, and graphics-context
  failure handling.
- [`gameplay-telemetry/`](gameplay-telemetry/README.md): the validated
  engine-independent standard for minimal, privacy-conscious gameplay-run
  summaries and operator-facing learning.
- [`race-presentation/`](race-presentation/README.md): the validated standard
  for legible countdown, lap/time status, recovery, finish results, and
  accessible race-state communication.
- [`race-progression/`](race-progression/README.md): the accepted
  engine-independent standard for explicit race lifecycle, deterministic
  timing, ordered checkpoints and laps, invalid-progression handling, and safe
  checkpoint recovery.
- [`player-input/`](player-input/README.md): the validated engine-independent
  standard for normalized driving actions, concurrent keyboard, touch, and
  controller support, device arbitration, cancellation, and accessible control
  presentation.
- [`course-editing/`](course-editing/README.md): the accepted document-centered
  standard for versioned course data, stable identities, primitive authoring,
  checkpoint ordering, validation, deterministic export, and edit history.
- [`chase-camera/`](chase-camera/README.md): the accepted engine-independent
  standard for motion-led vehicle framing, slip readability, impacts, airborne
  behavior, obstruction handling, and reset coherence.
- [`collisions/`](collisions/README.md): the accepted engine-independent
  standard for forgiving, physically coherent vehicle contacts, collision
  geometry, impact response, snag prevention, and tunneling protection.
- [`kart-physics/`](kart-physics/README.md): the accepted dynamic rigid-body,
  wheel-support, tire-force, airborne, and recovery standard for RC-style kart
  handling.
