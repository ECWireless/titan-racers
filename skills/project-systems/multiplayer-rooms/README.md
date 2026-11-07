# Multiplayer Rooms System

**Maturity:** Validated (PRs 6.4–6.6, 2026-11-07).

## Purpose And Scope

How Titan Racers runs multiplayer: private rooms of 2–4 on Falls View
Park, following the [rooms standard](../../game-concepts/multiplayer-rooms/README.md)
on [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md).
It owns join tokens, the room server, the room rules and protocol, the
lobby and room race, kart-to-kart contact by the
[contact standard](../../game-concepts/kart-to-kart-contact/README.md), and
what a finished room race stores.

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
- `src/game/room/room-connection.ts`: the page's WebSocket client, which
  reconnects and resends what the room missed.
- `src/game/room/room-race.ts`: the canvas's view of its room and opponent
  tracks; `src/game/room/opponent-motion.ts`: how each opponent is drawn
  from its states, and its present estimate for contact;
  `src/game/audio/remote-motor-voice.ts`: how each is heard.
- `src/game/room/kart-contact.ts`: the contact resolver the page and the
  room share (each kart's contact box from its snapshot, the swept test,
  and the two-body impulse); `src/game/room/page-contacts.ts`: a page's
  answers to its own kart's touches, the room records it fills in, and who
  is out of touch; `src/game/room/room-contacts.ts`: the room's one record
  per touch, in memory.
- `scripts/room-racers.ts` (`pnpm rooms:racers`): local guest racers that
  drive the gate line, for QA.
- `room-server/`: the Worker and the `Room` Durable Object, transport only,
  with `wrangler.jsonc` (local defaults and a `production` environment).
- `src/app/api/rooms/[code]/token/route.ts` and `src/server/room-races.ts`:
  issuing join tokens; `src/app/api/rooms/results/route.ts`: storing
  reports in `room_races` and `room_race_entries` (migration 0029).
- `src/app/room/[code]/page.tsx` and `src/components/room-play.tsx`: the
  lobby, the race view, and results.
- `src/components/solo-time-trial-canvas.tsx`, its `room` prop: the grid
  slot, the countdown and clock, kart states, drawing opponents, and each
  step's contacts (`stepKartContacts`).
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
  sees the ID. A guest's key is an HMAC of the room code and a random seat
  secret its page holds in memory, so the page retakes its seat when it
  reconnects and a reload is a new guest; without a secret, the key is
  random. The Worker checks the
  origin, the token, its room, and its protocol version before anything
  reaches the room's object.
- The room server owns membership, host (the longest-present connected
  player), readiness, the start, gates, finishes, places, and the end;
  clients simulate only their own kart, and predict their own gates and
  finish for the HUD. Every event first applies any deadline already
  passed, and one alarm wakes the room for the next, for a deadline or a
  connection about to count as silent. A message that changes nothing
  writes nothing. A socket may send a burst of 600 frames, refilled at 60 a
  second (a page sends about 32), and 20 messages that change the room,
  refilled at 5 a second; past either it is closed.
- A close with code 1000 (Leave room, or leaving the page) frees a seat at
  once; any other close, or 5 s of silence while racing (30 s otherwise),
  holds it for 30 s as away: shown as reconnecting, not hosting, and left
  out of a race that starts meanwhile. Past the hold the seat is given up,
  as leaving would. A rejoin's welcome names the race time of the last
  state the room accepted; the page resends the rest in batches, holding
  live states until then, and says again that it loaded or sat out its
  race, so a finish during the outage keeps its own time. Each socket's
  last-heard time lives in its attachment, so silence outlives
  hibernation. The page reconnects by itself, one attempt at a time,
  treats an unanswered ping as a drop (sooner while racing, never judging
  when its own check ran late), checks at once on becoming visible, and
  closes on a Chrome freeze to reconnect on resume. A page that can't race
  (its course or kart failed, or it reloaded into a race under way) sends
  `sit_out`, which drops it from the race at once.
- Clients keep the room's clock from pings (every second from a race's
  start, 20 s between races so the room can hibernate), keeping the
  quietest sample with an age penalty. Each frame reads it at the frame's
  own timestamp and charges any lag over 50 ms to the race clock, so time
  lost to a late start, a stall, or a pause counts, as the room's does.
- Each kart state is one fixed step's pose, with its race time and
  velocity. The room checks it against the kart's last accepted state by
  solo's run check (`checkRaceStep`); the first against its grid slot, as
  far as the speed cap reaches in its race time. No state's race time may
  run more than 250 ms ahead of the room's clock; one may lag it, as a
  resend does. The step that crosses a gate also carries where the kart was
  the step before, so the room checks the crossing the race did, and a
  crossing between two accepted states counts too, so one refused state
  doesn't end a race. The finish's state carries the result's time, which
  is the room's. A state that fails is neither counted nor relayed. The
  last accepted state is stored only with a reset or a gate, so after a
  restart the check runs from an older one, which only loosens it.
- States go out 30 times a second after a fixed step, plus one at each
  gate; a paused kart sends none. They are never stored. Each carries the
  kart's velocity and spin, and `o` while its page judges its own round
  trip too slow to answer a contact (protocol 3). Opponents are drawn
  through a jitter buffer (`opponent-motion.ts`), without physics, but
  within about 3 m of the player at its present estimate, easing back to
  the buffer by 8 m; each casts the player's contact shadow and is heard
  from the camera (`remote-motor-voice.ts`), staged as the player's own
  motor.
- Contact (PR 6.6): each fixed step, before physics, the page sweeps its
  own kart against each opponent's present estimate (its newest state
  carried on by its velocity and spin, plus pushes this kart gave it),
  applies its own share of the impulse, and carries the other's share. The
  room finds each touch in the live states it accepts, within the 5 mm
  slop, resolves it from the motion it saw bring each kart in, and sends
  both pages one `contact` record; a page that didn't answer it applies its
  share once, within 500 ms. A kart out of touch (states late or silent,
  `o`, just reset, finished, or its own states 250 ms apart) is drawn in
  the ghost material and touches nothing until clear. Touches knock like
  metal; `?perf=1` counts touching steps, fills, and the slowest step. The
  room keeps records in memory only, so a restart mid-race may record a
  touch in progress twice.
- A resent batch is checked state by state but stored once, spending one
  write from its own allowance (a burst of 60, refilled at 2 a second, a
  30 s outage's worth), not the live one; others are sent only its states
  within 500 ms of the room's clock, in order, so a reset among them still
  snaps. The finishing state goes twice, half a second apart, so a refused
  one still counts.
- Rooms run on the Free plan; four players send about 128 messages a
  second, which Free may count one by one (see [Cloudflare Durable
  Objects](../../tools/cloudflare-durable-objects/README.md) for billing).
- `?net=delay,jitter` (ms) holds back opponents' states and the room's
  contact records on this page, in order, so they bunch, to try the motion
  on a bad connection; `?perf=1` adds how many opponent frames ran past
  their newest state, and the longest delay.
- A race is entered only before it has a start time; a reload mid-race
  sits it out and waits in the lobby. The canvas hides its solo finish,
  stops once the race is over, and the room page shows each race's results
  as first seen.
  Finishers place by time, everyone else by gates passed, then by the race
  time of their last, whether or not they left.
- A finished race is reported once, signed, and stored once by race ID,
  without account IDs or usernames. The app refuses reports for course or
  kart revisions never published; the room server retries only server
  errors, 408, and 429. Room races never touch leaderboards, ghosts, run
  tickets, or run summaries.

## Known Limits

- A reload is a new visit: it doesn't resume a race, even with the seat.
- Contact keeps its [standard's known limits](../../game-concepts/kart-to-kart-contact/README.md#known-limits).
- Each touch is one box per kart, the hull to the wheel guard's top: a
  graze under about a millimetre can go unseen, and a hard angled hit
  briefly sinks a centimetre or two in free flight.
- The test racers (`pnpm rooms:racers`) are pushed only by the room's
  records, a round trip late, so they feel heavier than a player.
- Opponents are drawn with this page's version of their kart, so across a
  kart republish one can look like its other version, or not appear.
- No public matchmaking or room leaderboard.

## Verification

- `tests/opponent-motion.spec.ts`: the jitter buffer, guesses and their
  blend, resets, clock jumps, and stalls, and the present estimate and
  near drawing; `tests/remote-motor-voice.spec.ts`: how an opponent is
  heard; `tests/room-connection.spec.ts`: the page's reconnect, resend,
  repeated `loaded`, judgment of its own round trip, and the records it
  keeps, against a fake socket.
- `tests/kart-contact.spec.ts`: the resolver; `tests/room-contacts.spec.ts`:
  the room's one record per touch; `tests/page-contacts.spec.ts`: a page's
  answers and out-of-touch rules, and two pages simulated through the
  room's tracker.
- `tests/room-rules.spec.ts`, `tests/room-signing.spec.ts`,
  `tests/room-clock.spec.ts`, and the room tests in
  `tests/race-session.spec.ts`: pure rules, state checks, signing, the
  token's course and grid, and clocks (`tests/support/room-course.ts` is a
  straight test course).
- `tests/room-server.spec.ts`: Node clients against `wrangler dev`
  (`tests/support/room-server.ts`), including a held seat, its resend, and
  silent connections in a race and in a sleeping lobby.
- `tests/rooms.spec.ts`: the token and results routes against Postgres.
- `tests/room-race.spec.ts`: two browsers race one room on one clock,
  crossing gates no faster than the room's check allows, the guest losing
  its connection for a lap gate (`page.routeWebSocket`), and the host
  hearing the guest; and a page pushed at once by a Node rival, with a
  missed touch's record pushed once.
- `tests/admin-overview.spec.ts`: the dashboard's room counts.

## Related

- [Multiplayer rooms standard](../../game-concepts/multiplayer-rooms/README.md)
- [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md)
- [Race progression](../race-progression/README.md)
- [Ghosts](../ghosts/README.md): the playback opponents reuse.
- [Kart-to-kart contact standard](../../game-concepts/kart-to-kart-contact/README.md)
