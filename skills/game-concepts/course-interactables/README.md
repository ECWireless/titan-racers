# Course Interactables

**Maturity:** Candidate (PR 6.9, 2026-11-08).

## Purpose And Scope

This node defines the engine-independent standard for course objects that
change state during a race: a door whose latch gives way, and later ones
such as barriers, loose props, or gates that swing. Read it before adding
one, or changing how one is authored, simulated, reset, shared in a room,
recorded, or heard.

It inherits impact response from [collisions](../collisions/README.md),
the room's authority and clock from
[multiplayer rooms](../multiplayer-rooms/README.md), and the
answer-at-once, record-once pattern from
[kart-to-kart contact](../kart-to-kart-contact/README.md). It does not own
damage to karts, or objects that move on their own (lifts, traffic).

## Standard

- **State changes come from physics, not triggers.** An object changes
  state because a real mechanism gave way: a latch with a breaking
  strength, a hinge with stops and friction. It never opens on entering a
  volume, or on a rule the world doesn't explain, so where and how hard
  the hit landed always matters.
- **Strength has a physical story.** Choose each strength from what the
  object is (a worn latch, a light barrier) and state it as the hit that
  breaks it: the kart's mass and speed, square on, at a named point. A
  push under a kart's own drive force never breaks it.
- **True size, true mass.** The object keeps its real size and mass. At
  1:10 a kart weighs about 2 kg, so a full-size object moves as a real one
  would under an RC car: a steel door whose latch pops swings ajar, and
  opens wide only to a much harder hit or a push.
- **Few named states.** An object has a few discrete states (closed,
  open), and physical motion within them. The change of state is the
  event that is recorded and shared; the motion is the simulation's own.
- **Authored by versioned type.** A course places an object by a versioned
  type (its mass, strength, and friction) plus its own geometry. New
  values are a new type version, so a course revision always races the
  same object.
- **Every race starts as authored.** Objects return to their authored state
  at each race start, restart, and race again, never on a kart's own reset
  or recovery, which would let one player undo the world.
- **Stay out of what counts.** An object must not change what the run
  check, gates, or recordings depend on. A space behind it that leads
  nowhere keeps the leaderboard. One that opens a route changes what a time
  means, so it needs its own leaderboard and its own check.
- **Ghosts don't interact.** A ghost replays poses: it neither opens an
  object nor is stopped by one.
- **In a room, answer at once and record once.** The client whose kart
  caused the change applies it at once and tells the server. The server
  keeps the first claim per object per race and checks that it is
  plausible: the claimant is racing, and its last accepted pose was near
  the object. It tells every client, and its snapshot carries the race's
  changes, so a returning client catches up.
- **Show the cause before the effect.** Other clients draw opponents
  slightly in the past. They apply a change when the opener, as drawn
  there, reaches the change's race time, with its recorded motion (a
  swing speed), so the hit is seen before the door moves. A record long
  past is applied at rest.
- **After the change, each client's copy is its own.** The object's motion
  is not streamed. Each client's copy answers only its own kart, and every
  copy settles at the same rest (a stop), so they converge without sync.
  This is only acceptable for objects that cannot change standings.
- **Sound and light follow the state.** A latch's clack, a stop's thud, or
  a lamp that comes on is driven one-way from the simulation, like all race
  sound ([game audio](../game-audio/README.md)).
- **At rest, it costs nothing.** A resting object sleeps in physics. Budget
  its draws, lights, and sounds like any other course piece.

## Failure Modes

- A trigger or scripted opening reads as arcade and ignores the hit.
- A strength without a physical story either never breaks or breaks on
  every scrape.
- Resetting on a kart's reset lets one player reset what everyone sees.
- Streaming the object's motion spends bandwidth on something that can't
  change a result. Trusting each client's own state instead lets two
  clients disagree for the rest of the race.
- Applying a remote change on arrival opens a door before its opener is
  seen to reach it.
- Letting a later claim replace an earlier one makes an opening flap.
- An object that opens a shortcut quietly changes what a leaderboard means.
- Keeping state between races makes the next race a different course.

## Validation

- Controlled hits just under and just over the stated strength, a push at
  full drive force, and a hit near the hinge.
- A race start, restart, and race again each restore the object; a kart's
  own reset does not.
- The server's first claim, plausibility check, and snapshot, as pure
  rules.
- Two clients: the opener's change shown at once, the other's after the
  opener is seen to reach it, and both at the same rest.
- The run check, gates, and recordings unchanged by an open or closed
  object.

## Tool Mappings

- [PlayCanvas and Ammo constraints](../../tools/playcanvas-ammo/constraints/README.md):
  hinges, breakable latches, and why the engine's joint component isn't
  used.

## Related

- [Collisions](../collisions/README.md)
- [Kart-to-kart contact](../kart-to-kart-contact/README.md)
- [Multiplayer rooms](../multiplayer-rooms/README.md)
- [Ghosts](../ghosts/README.md)
- [Game audio](../game-audio/README.md)

## Sources

- Bullet, `btSequentialImpulseConstraintSolver.cpp` (breaking thresholds
  clamp and then disable a constraint):
  <https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/ConstraintSolver/btSequentialImpulseConstraintSolver.cpp>
- Glenn Fiedler, Networked Physics in Virtual Reality (authority over the
  objects a player touches, with the host as arbiter):
  <https://gafferongames.com/post/networked_physics_in_virtual_reality/>
- Valve, Source Multiplayer Networking (others drawn in the past, and
  interactions judged as their player saw them):
  <https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking>
