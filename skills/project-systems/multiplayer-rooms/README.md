# Multiplayer Rooms System

**Maturity:** Candidate (PR 6.4, 2026-11-05).

## Purpose And Scope

How Titan Racers runs Race Friends: private rooms of 2–4 on Falls View
Park, following the [rooms standard](../../game-concepts/multiplayer-rooms/README.md)
on [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md).
It owns join tokens, the room server, the room rules and protocol, the
lobby and room race, and what a finished room race stores.

## Source Ownership

- `src/game/room/room-protocol.ts`: the wire protocol and its version, close
  codes, room codes, limits and deadlines, and the result report's shape.
- `src/game/room/room-rules.ts`: the transport-free rules, from room state
  and an event to the next state, the snapshot to broadcast, and any
  report, including the check on each kart state.
- `src/game/room/room-course.ts`: the course a room checks states against,
  built from the course document for join tokens, and the grid slots.
- `src/game/race/race-verification.ts`: the run check's step,
  `checkRaceStep`, shared by solo runs and rooms.
- `src/game/room/room-signing.ts`: Web Crypto HMAC for join tokens,
  per-room account keys, and signed reports, shared by Node and the Worker.
- `src/game/room/room-clock.ts`: the client's estimate of the room's clock.
- `src/game/room/room-connection.ts`: the page's WebSocket client.
- `src/game/room/room-race.ts`: the canvas's view of its room and opponent
  tracks (a `GhostPlayback` each, appended as states arrive).
- `room-server/`: the Worker and the `Room` Durable Object, transport only,
  with `wrangler.jsonc` (local defaults and a `production` environment).
- `src/app/api/rooms/[code]/token/route.ts` and `src/server/room-races.ts`:
  issuing join tokens; `src/app/api/rooms/results/route.ts`: storing
  reports in `room_races` and `room_race_entries` (migration 0029).
- `src/app/room/[code]/page.tsx` and `src/components/room-play.tsx`: the
  lobby, the race view, and results.
- `src/components/solo-time-trial-canvas.tsx`, its `room` prop: the grid
  slot, the countdown and clock, kart states, and drawing opponents.
- `src/server/admin-overview-repository.ts`: the dashboard's room counts.
- Operations (secrets, local dev, deploy order):
  [`docs/database-operations.md`](../../../docs/database-operations.md#private-rooms).

## Behavior And Invariants

- A room exists while someone is in it. Its first join, or the first after
  it empties, fixes its course (gates, reset points, and grid, from that
  join's token, rounded to micrometres; a course over 16 checkpoints, or
  whose token would pass 12 KB, can't host rooms), course revision, and
  physics and protocol versions. A join on another protocol or physics version, or
  another course, is refused with "refresh"; later joiners race the room's
  course revision. Its storage is deleted 10 minutes after it empties and
  any report is delivered.
- The app signs a 60-second token per connection. A signed-in account,
  including one kept only in a browser, joins with an HMAC of the room code
  and its ID, so a second tab takes the same seat and the room server never
  sees the ID; a guest's key is random per token. The Worker checks the
  origin, the token, its room, and its protocol version before anything
  reaches the room's object.
- The room server owns membership, host (the longest present), readiness,
  the start, gates, finishes, places, and the end; clients simulate only
  their own kart, and predict their own gates and finish for the HUD. Every event first applies any deadline already passed,
  and one alarm wakes the room for the next. A message that changes nothing
  writes nothing. A socket may send a burst of 300 frames, refilled at 30 a
  second, and 20 messages that change the room, refilled at 5 a second;
  past either it is closed.
- Clients keep the room's clock from pings (every 5 s in a race, 20 s
  between races so the room can hibernate), keeping the quietest sample
  with an age penalty. Each frame reads it at the frame's own timestamp and
  charges any lag over 50 ms to the race clock, so time lost to a late
  start, a stall, or a pause counts, as the room's does.
- Each kart state is one fixed step's pose, with its race time and
  velocity. The room checks it against the kart's last accepted state by
  solo's run check (`checkRaceStep`): a step later, at most 30 m/s, resets
  only to the newest reset point, and a gate crossed in order. The first is
  checked against its grid slot, as far as 30 m/s reaches in its race time,
  and no state's race time may run more than 250 ms ahead of the room's
  clock. The step that crosses a gate also carries where the kart was the
  step before, so the room checks the crossing the race did; the finish's
  is sent at frame end with the result's time, which is the room's. A state
  that fails is neither counted nor relayed. The last accepted state is
  stored only with a reset or the next change, so after a restart the check
  runs from an older one on the same stretch, which only loosens it. A
  stored state (a gate or a reset) spends from the smaller allowance.
- States go out 10 times a second after a fixed step, plus one at each gate;
  a paused kart sends none. They are never stored, and are drawn 200 ms
  behind, held still at the newest rather than extrapolated. Opponents are
  solid and drawn without physics.
- A race is entered only before it has a start time; a reload mid-race
  waits in the lobby. The canvas hides its solo finish, stops once the race
  is over, and the room page shows each race's results as first seen.
  Finishers place by time, everyone else by gates passed, then by the race
  time of their last, whether or not they left.
- A finished race is reported once, signed, and stored once by race ID,
  without account IDs or usernames. The app refuses reports for course or
  kart revisions never published; the room server retries only server
  errors, 408, and 429. Room races never touch leaderboards, ghosts, run
  tickets, or run summaries.

## Known Limits

- No reconnect: leaving or losing the connection means not finishing.
- No kart-to-kart contact; karts pass through each other.
- Opponents are silent and cast no contact shadow.
- Opponents are drawn with this page's version of their kart, so across a
  kart republish one can look like its other version, or not appear.
- No prediction or correction beyond the 200 ms delay.
- No public matchmaking or room leaderboard.

## Verification

- `tests/room-rules.spec.ts`, `tests/room-signing.spec.ts`,
  `tests/room-clock.spec.ts`, and the room tests in
  `tests/race-session.spec.ts`: pure rules, state checks, signing, the
  token's course and grid, and clocks (`tests/support/room-course.ts` is a
  straight test course).
- `tests/room-server.spec.ts`: Node clients against `wrangler dev`
  (`tests/support/room-server.ts`).
- `tests/rooms.spec.ts`: the token and results routes against Postgres.
- `tests/room-race.spec.ts`: two browsers race one room on one clock,
  crossing gates no faster than the room's check allows.
- `tests/admin-overview.spec.ts`: the dashboard's room counts.

## Related

- [Multiplayer rooms standard](../../game-concepts/multiplayer-rooms/README.md)
- [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md)
- [Race progression](../race-progression/README.md)
- [Ghosts](../ghosts/README.md): the playback opponents reuse.
