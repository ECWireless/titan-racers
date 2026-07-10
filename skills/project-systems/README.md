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

No child project-system nodes have been established yet. Add them as systems become stable enough to document without competing with active phase planning.
