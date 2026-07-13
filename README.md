# Titan Racers Demo

Playable demo app for Titan Racers.

`IMPLEMENTATION_PLAN.md` is the source of truth for scope, phase order, and product constraints. New sessions should also read `AGENTS.md` and `docs/session-workflow.md` before implementation work.

## Development

```bash
cp .env.example .env
docker compose up -d postgres
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm dev
```

Database migration, Google OAuth, first-admin bootstrap, permanent sandbox
course reset, and the current manual production workflow are documented in
[`docs/database-operations.md`](docs/database-operations.md).

## Phase 0 Scope

- Next/React app shell.
- Shared Titan Racers typography and visual tokens.
- Minimal public home screen with non-functional play placeholders.
- Local environment template.
- Agent/session guardrail docs.
