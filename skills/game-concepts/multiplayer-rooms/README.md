# Multiplayer Rooms

**Maturity:** Candidate (PR 6.4, 2026-11-05).

## Purpose And Scope

This node defines the engine-independent standard for a small private room
in which a few players race together: membership, readiness, a shared
start, opponents on track, a shared finish, and racing again. Read it before
changing the room lifecycle, its clock, how opponents are drawn, or what a
room race records.

It inherits race timing and gate acceptance from
[race progression](../race-progression/README.md) and countdown and result
presentation from [race presentation](../race-presentation/README.md), with
one override: in a room, time spent paused, hidden, or stalled counts toward
the player's race time, since the room's race does not stop for one player.
It does not own kart-to-kart contact
([collisions](../collisions/README.md)) or the motion model's prediction and
correction.

## Standard

- **One authority per room.** A single room server owns membership, host,
  readiness, the start time, progress, finish order, and placements. Each
  client simulates only its own kart and reports it; opponents are
  presentation.
- **Explicit lifecycle.** Lobby, loading, countdown, racing, and results are
  distinct phases with one owner of each transition. Every wait has a
  deadline, so one slow, silent, or departed player can never hang the room.
- **Readiness is a choice, not a button.** Choosing a kart marks a player
  ready. The host starts once enough players are ready; anyone not ready
  sits that race out and joins the next.
- **Host is a role, not a person.** The longest-present player hosts, and
  the role passes on when they leave.
- **Start on one clock.** The server names a future start time on its clock.
  Each client estimates its offset from timed pings, NTP-style, keeping the
  sample with the shortest round trip, since it has the least asymmetry.
  Clients convert the start to local time and run the countdown toward it.
- **Race time reads the room's.** Any local lag, such as a late start, a
  frame hitch, a pause, or a hidden tab, is charged to the player's own race
  clock rather than stopping the room. Pausing stops your kart, not the race.
- **Draw opponents in the past.** Keep a short buffer of opponent states and
  draw each slightly behind the newest update, interpolating between real
  samples, so motion stays smooth through jitter. Never extrapolate far.
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

## Failure Modes

- Starting on each client's "go" message adds each player's latency to
  their start, so the fastest connection always leads.
- Pausing the room for one player's pause or hidden tab lets any player
  stall everyone.
- Drawing opponents at their newest update makes them stutter with every
  late or bunched packet; extrapolating far makes them overshoot corners.
- Waits without deadlines (loading, the last finisher) hang the room.
- A host-only room dies when the host leaves.

## Validation

- Pure tests of the room rules: join limits, host handover, start rules,
  deadlines, placements, and replay.
- Two real clients against the room server, through the full lifecycle.
- Two devices side by side: countdowns in step, opponents moving smoothly,
  and identical results.

## Related

- [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md)
- [Race progression](../race-progression/README.md)
- [Race presentation](../race-presentation/README.md)
- [Runtime resilience](../runtime-resilience/README.md)
- [Collisions](../collisions/README.md)

## Sources

- RFC 5905, Network Time Protocol v4, on-wire offset and delay:
  <https://www.rfc-editor.org/rfc/rfc5905>
- Valve, Source Multiplayer Networking, entity interpolation:
  <https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking>
- Gabriel Gambetta, Entity Interpolation:
  <https://www.gabrielgambetta.com/entity-interpolation.html>
