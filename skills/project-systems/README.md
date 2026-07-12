# Project Systems

This branch documents how Titan Racers currently combines game concepts and tools into implemented systems. It is the bridge between reusable guidance and the repository's actual architecture, behavior, and source files.

## Read This Branch When

- changing an existing Titan Racers system,
- tracing ownership or data flow across source files,
- checking how an accepted concept is currently implemented,
- reviewing whether a change preserves project-specific contracts,
- locating related concept and tool guidance before editing.

## Guidance Contract

Project-system nodes should describe:

- the system's current responsibilities and boundaries,
- relevant source files and runtime entry points,
- accepted behavior and invariants,
- concept nodes that define desired behavior,
- tool nodes that explain implementation constraints,
- verification paths,
- known limitations or deferred work.

The source code and authoritative project documents remain the final authority for current behavior and approved scope. Update a project-system node when accepted implementation changes make its description stale.

## Current Children

- [Course data](course-data/README.md): versioned validated course documents,
  canonical seed/export serialization, stable authored IDs, bounded primitive
  geometry, start/checkpoint data, and PlayCanvas construction.
- [Chase camera](chase-camera/README.md): motion-led heading and look-ahead,
  slip and reverse policy, speed framing, impact and airborne response,
  obstruction correction, explicit snapping, diagnostics, and camera fixtures.
- [Kart physics](kart-physics/README.md): fixed-step simulation, dynamic chassis,
  wheel support and tire forces, presentation interpolation, telemetry, and
  reset behavior.
- [Collisions](collisions/README.md): compound kart envelope, course collision
  geometry, filtering, contact observation, targeted CCD, response telemetry,
  ramps, and controlled impact verification.
