# Titan Racers Demo

Browser-playable RC kart racing inside the Titan Racers world. The current
Phase 2 build is a complete rough-course prototype: choose Solo Time Trial,
drive two laps with keyboard, touch, or controller, recover at checkpoints, and
finish or replay without signing in.

`IMPLEMENTATION_PLAN.md` remains the source of truth for upcoming demo scope and
phase order. New implementation sessions must also follow `AGENTS.md` and
`docs/session-workflow.md`.

## Current Phase 2 Build

- PlayCanvas and Ammo runtime with a bounded 60 Hz fixed-step simulation.
- Dynamic rigid-body kart handling, wheel support, forgiving collisions, and a
  motion-led chase camera.
- Data-driven rough course with ordered checkpoints, two-lap timing, safe
  recovery, countdown, pause, finish, and replay states.
- Unified keyboard, touch, and standard-gamepad driving plus controller menu
  navigation.
- Protected admin course editor backed by Better Auth, Postgres revisions,
  private drafts, explicit publishing, and a permanent rough-course sandbox.
- Anonymous run-level telemetry, protected operational summaries, and Vercel
  page analytics with no raw input, movement paths, device identity, or
  per-frame capture.
- Runtime resilience for focus/visibility interruption, input cancellation,
  resize/orientation changes, bounded low-frame-rate degradation, cancellable
  loading, and recoverable WebGL context loss.

Phase 2 deliberately stops at one rough kart and the rough test loop. Kart
uploads, Agricultural Zone visual production, ghosts, leaderboard submission,
and multiplayer remain later phases.

## Controls

| Action | Keyboard | Touch | Standard controller |
| --- | --- | --- | --- |
| Steer | A / D or arrows | Steering pad | Left stick or D-pad |
| Accelerate | W or up arrow | Accelerator | Right trigger |
| Brake / reverse | S or down arrow | Brake / Reverse | Left trigger |
| Recover kart | R | Reset button | A |
| Pause / resume | Escape | Pause button | Start |

Controller A confirms focused menu actions and B returns from supported race
overlays. Touch controls appear for coarse-pointer devices.

## Local Development

Requirements: a current Node.js release compatible with the checked-in
toolchain, Corepack, Docker, and Chromium for browser tests.

```bash
cp .env.example .env
docker compose up -d postgres
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm dev
```

Open `http://localhost:3000`. Guest racing does not require OAuth. Protected
editor and telemetry routes require a database-backed admin account.

Database migration, Google OAuth, first-admin bootstrap, permanent sandbox
course reset, runtime-health fields, and the current manual production workflow
are documented in [`docs/database-operations.md`](docs/database-operations.md).

## Verification

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm db:check
corepack pnpm build
corepack pnpm test:e2e
```

Database-backed tests read the ignored `.env` file when invoked through Node's
`--env-file=.env` option. The Playwright matrix covers desktop and mobile
projects; focused tests also exercise keyboard, touch, controller, race
progression, telemetry failure, lifecycle interruption, resize, and WebGL
context recovery.

## Architecture Guide

- `src/game/`: engine-independent contracts plus PlayCanvas runtime, physics,
  input, race, course, camera, editor, and telemetry systems.
- `src/components/`: player and protected admin React surfaces.
- `src/app/api/`: guarded course, auth-adjacent, publication, and telemetry
  routes.
- `src/server/` and `src/db/`: centralized authorization, repositories, and
  Drizzle schema ownership.
- `drizzle/`: reviewed forward-only Postgres migrations.
- `skills/`: progressively disclosed game-concept, tool, and shipped-system
  knowledge for future implementation work.
- `tests/`: deterministic pure, browser, and real-database verification.

The rough course is both the current playable loop and a permanent engineering
sandbox. Its stable `rough-course` ID must remain separate from the future
player-facing `agricultural-zone` course.
