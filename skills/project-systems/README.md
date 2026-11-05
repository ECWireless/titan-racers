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

- [Kart builder](kart-builder/README.md): kart document, approved part
  registry, validation, server-side derivation, immutable revisions and
  publication, the admin kart editor, racer usernames, and the official roster.
- [Kart thumbnails](kart-thumbnails/README.md): exact revision-bound kart
  previews, deterministic browser capture, immutable persistence, protected
  draft access, and privacy-minimized public delivery.
- [Scene lighting](scene-lighting/README.md): the shared tone mapping,
  habitat environment light, kart material, and shadow policy for every
  PlayCanvas application, plus the local `?perf=1` phone-budget overlay.
- [Runtime resilience](runtime-resilience/README.md): lifecycle safety pauses,
  fixed-step overload bounds, resize reconciliation, WebGL recovery, and coarse
  run-health summaries.
- [Gameplay telemetry](gameplay-telemetry/README.md): guest and signed-in run
  summaries, guarded milestone ingestion, the at-a-glance admin dashboard and
  operational telemetry view, and automatic Vercel page views.
- [Race presentation](race-presentation/README.md): authoritative snapshot
  projection, countdown, lap/time HUD, recovery announcement, finish results, and
  keyboard/controller replay flow.
- [Race progression](race-progression/README.md): deterministic lifecycle,
  directed swept checkpoint gates, ordered laps, monotonic timing, pause-safe
  fixed-step integration, and checkpoint recovery.
- [Ghosts](ghosts/README.md): the race recording format and recorder, ghost
  playback and look, your best on this device, and the Ghost switch.
- [Multiplayer rooms](multiplayer-rooms/README.md): Race Friends' join
  tokens, room server, rules and protocol, room clock, lobby and room race,
  and stored room results.
- [Leaderboard](leaderboard/README.md): signed run tickets, the server's
  check of a run's recording, results, each racer's best per board, the
  leaderboard page, and podium medals.
- [Player input](player-input/README.md): normalized fixed-step driving actions,
  keyboard, multi-touch, and standard-gamepad adapters, intentional-activity
  arbitration, cancellation, accessible touch controls, reset, and pause.
- [Editor controller input](editor-controller-input/README.md): best-effort
  standard-controller navigation, viewport engagement, camera control,
  screen-relative snapped transforms, focus lifecycle, and accessible feedback
  across the home screen and protected editors.
- [Protected course editor](course-editor/README.md): protected revision loading,
  responsive document authoring, PlayCanvas picking and gizmos, mobile precision
  controls, collision diagnostics, private drafts, and live publication.
- [Identity and course persistence](identity-course-persistence/README.md):
  Better Auth Google and wallet identities, explicit login-method linking,
  Postgres sessions and roles, centralized admin
  authorization, Drizzle migrations, immutable course revisions, and protected
  load/save APIs.
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
