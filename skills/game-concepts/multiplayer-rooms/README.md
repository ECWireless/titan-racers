# Multiplayer Rooms

**Maturity:** Candidate (PR 6.5, 2026-11-05).

## Purpose And Scope

This node defines the engine-independent standard for a small private room
in which a few players race together: membership, readiness, a shared
start, opponents on track, a shared finish, and racing again, and how
motion and the room survive a real network. Read it before changing the
room lifecycle, its clock, what the server checks, how opponents are drawn,
reconnecting, or what a room race records.

It inherits race timing and gate acceptance from
[race progression](../race-progression/README.md) and countdown and result
presentation from [race presentation](../race-presentation/README.md), with
one override: in a room, time spent paused, hidden, or stalled counts toward
the player's race time, since the room's race does not stop for one player.
It does not own kart-to-kart contact
([kart-to-kart contact](../kart-to-kart-contact/README.md)), which
overrides how opponents near the player's kart are drawn and estimated.

## Standard

- **One authority per room.** A single room server owns membership, host,
  readiness, the start time, progress, finish order, and placements. Each
  client simulates only its own kart and reports it; opponents are
  drawn and estimated, never simulated.
- **Explicit lifecycle.** Lobby, loading, countdown, racing, and results are
  distinct phases with one owner of each transition. Every wait has a
  deadline, so one slow, silent, or departed player can never hang the room.
- **Readiness is a choice, not a button.** Choosing a kart marks a player
  ready. The host starts once enough players are ready; anyone not ready
  sits that race out and joins the next.
- **Host is a role, not a person.** The longest-present connected player
  hosts. The role passes on when they leave or drop, and returns if they
  come back.
- **Start on one clock.** The server names a future start time on its clock.
  Each client estimates its offset from timed pings, NTP-style, keeping the
  sample with the shortest round trip, since it has the least asymmetry.
  Clients convert the start to local time and run the countdown toward it.
- **Race time reads the room's.** Any local lag, such as a late start, a
  frame hitch, a pause, or a hidden tab, is charged to the player's own race
  clock rather than stopping the room. Pausing stops your kart, not the race.
- **Standings from progress.** Order racers by gates passed, breaking ties
  by who crossed the latest gate first; finishers by finish time.
- **End without waiting forever.** A race ends when every active player has
  finished, a short grace after the first finisher, or at a hard cap.
  Leaving, or losing the connection without reconnecting, means not
  finishing.
- **Everyone sees the same result.** The server sends one result to every
  player, and Race again returns the same room to its lobby.
- **Version the protocol.** Messages carry or inherit a protocol version,
  and a room refuses a mismatched client with a clear "refresh" message
  rather than misreading its messages.
- **Rooms are private and lightweight.** Joining is by an unguessable link.
  A room needs no stored record to exist, and what it keeps after a race
  holds no account identity.

### Authority And Motion

- **Each client owns its own motion; the server owns what counts.** A
  client simulates and reports its kart. The server checks each report for
  plausibility (where it starts, a speed cap, legal resets, gates crossed
  in order) and derives progress and finish times from the reports, never
  from a client's claim. A forged stream that obeys the checks still
  passes: the bar is plausibility, not anti-cheat.
- **Predict only your own outcomes; the server reconciles.** A client
  shows its own gates, laps, and finish at once, and the server's state
  decides standings and results; where they differ, the server's wins.
  Replaying unacknowledged inputs (Gambetta's reconciliation) is for
  movement the server simulates; a client-simulated kart has none to
  replay.
- **Draw opponents from a jitter buffer.** Send states often, each with
  its time and velocity, and draw each opponent far enough behind its
  newest state to stay between real ones. Size that delay per opponent
  from how late its states arrive, and change it by playing slightly
  faster or slower, never by jumping. A Hermite curve through each
  state's own velocity needs only its two end states. Raising the send
  rate shrinks the delay more safely than extrapolating: Fiedler finds
  about three send intervals plus jitter enough (150 ms at 30 a second).
- **Extrapolate briefly; correct within bounds.** When the buffer runs dry,
  carry on along the last velocity for a short, capped time, then hold. When
  a newer state shows the error, blend it out over a short fixed time. Snap
  only for a teleport (a reset) or a long gap.
- **Keep the drawn pose apart from the state behind it.** Visuals, shadow,
  and sound read the drawn pose; standings and plausibility checks read
  received states, and contacts an estimate built from them.
- **Order by time, not arrival.** Each state carries its race time; an
  older or repeated one is dropped.

### Resilience

- **Over TCP, loss is delay or a dead connection.** A WebSocket loses and
  reorders nothing within one connection, so trouble arrives as bunched
  messages and as whatever was in flight when a connection dies. Detect a
  dead connection within seconds from an unanswered ping, and reconnect
  automatically with backoff.
- **Hold a dropped seat briefly.** A held seat keeps its place and its
  race, but no role that others wait on, such as host. Past the hold, the
  player has left.
- **Resume without loss.** The server tells a returning client the last
  state it accepted, and the client resends the rest from a short history.
- **Hidden, frozen, and discarded pages.** A hidden page pauses its own kart
  ([runtime resilience](../runtime-resilience/README.md)). A frozen page
  runs no timers or callbacks and should close its sockets, and a discarded
  one reloads: to the room, both are a dropped connection, never a reason to
  stop the race.
- **Drop out explicitly.** A client that cannot take part, such as one
  whose race failed to load, tells the server at once rather than leaving
  everyone to wait out a deadline.

## Failure Modes

- Starting on each client's "go" message adds each player's latency to
  their start, so the fastest connection always leads.
- Pausing the room for one player's pause or hidden tab lets any player
  stall everyone.
- Drawing opponents at their newest update makes them stutter with every
  late or bunched packet; extrapolating far makes them overshoot corners.
- A curve that needs the state after its end bends when that state lands,
  and holds still when it is late, so opponents look choppy.
- Short stalls on one client look to others like a stop and a lurch
  unless the drawing eases through them.
- Trusting progress messages lets a client finish without driving.
- Freeing a seat the moment its connection drops turns every network blip
  into a lost race.
- Waits without deadlines (loading, the last finisher) hang the room.
- A host-only room dies when the host leaves.

## Validation

- Pure tests of the room rules: join limits, host handover, start rules,
  deadlines, placements, replay, held seats, and the plausibility check.
- Pure tests of the jitter buffer against arrival schedules with jitter,
  bunching, gaps, reordering, and resets.
- A connection dropped mid-race and resumed against the real server.
- Two real clients against the room server, through the full lifecycle.
- Two devices side by side: countdowns in step, opponents moving smoothly
  with added delay and jitter, a dropped connection resumed, and identical
  results.

## Related

- [Multiplayer rooms system](../../project-systems/multiplayer-rooms/README.md)
- [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md)
- [Race progression](../race-progression/README.md)
- [Race presentation](../race-presentation/README.md)
- [Runtime resilience](../runtime-resilience/README.md)
- [Kart-to-kart contact](../kart-to-kart-contact/README.md)

## Sources

- RFC 5905, Network Time Protocol v4, on-wire offset and delay:
  <https://www.rfc-editor.org/rfc/rfc5905>
- Valve, Source Multiplayer Networking, entity interpolation:
  <https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking>
- Gabriel Gambetta, Entity Interpolation:
  <https://www.gabrielgambetta.com/entity-interpolation.html>
- Gabriel Gambetta, Client-Side Prediction and Server Reconciliation:
  <https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html>
- Glenn Fiedler, Snapshot Interpolation:
  <https://gafferongames.com/post/snapshot_interpolation/>
- RFC 6455, The WebSocket Protocol: <https://www.rfc-editor.org/rfc/rfc6455>
- Chrome, Page Lifecycle API:
  <https://developer.chrome.com/docs/web-platform/page-lifecycle-api>
