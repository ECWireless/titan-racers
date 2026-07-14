# Tools

This branch documents the engines, libraries, platforms, and development tools used by Titan Racers. It owns tool-specific capabilities, constraints, APIs, integration patterns, and verified operating methods.

## Read This Branch When

- implementing a game concept with a specific engine or library,
- evaluating whether a tool supports a required behavior,
- diagnosing tool-specific runtime or build behavior,
- checking version-sensitive APIs or limitations,
- recording a verified workflow that is reusable across project systems.

## Guidance Contract

Tool nodes should distinguish:

- verified project behavior from assumptions,
- stable concepts from version-sensitive details,
- recommended APIs from workarounds,
- tool limitations from project-specific architectural choices.

Prefer primary documentation and direct runtime evidence. Link back to relevant nodes under `../game-concepts/` and forward to systems under `../project-systems/` rather than duplicating their guidance.

## Current Children

- [`browser-race-presentation/`](browser-race-presentation/README.md): the
  candidate mapping from authoritative race snapshots to bounded React updates,
  semantic HUD/dialog presentation, safe-area layout, and controller focus.
- [`browser-player-input/`](browser-player-input/README.md): the validated
  mapping from normalized player actions to browser Keyboard Events, Pointer
  Events, Gamepad API polling, React touch controls, and the repository-owned
  fixed-step PlayCanvas runtime.
- [`playcanvas-ammo/`](playcanvas-ammo/README.md): the accepted mapping from
  Titan Racers' fixed-step kart-physics standard to PlayCanvas and Ammo/Bullet.
