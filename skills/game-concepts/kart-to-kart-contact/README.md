# Kart-To-Kart Contact

**Maturity:** Validated (PR 6.6, 2026-11-07).

## Purpose And Scope

This node defines the engine-independent standard for contact between karts
in a room where each client simulates only its own kart: who decides a
contact, how each kart responds, and how opponents near the player are drawn
so a contact reads as one. Read it before changing how karts touch in a
room, how nearby opponents are drawn, or what the room sends about a
contact.

It inherits the room's authority, clock, and opponent drawing from
[multiplayer rooms](../multiplayer-rooms/README.md), and the contact-response
principles (no teleports, glancing motion survives, deliberate energy loss)
from [collisions](../collisions/README.md). Near the player's own kart it
overrides two rooms rules: opponents are drawn at the present rather than in
the past, and estimated ahead of their newest state for as long as they stay
in touch rather than briefly.

## Standard

- **Respond at once on each kart's own client; record once on the server.**
  Each kart has one fixed owner, its own client, which simulates it and
  sends its state, with nothing rolled back or re-simulated (Fiedler);
  unlike Fiedler's cubes, ownership never moves. Each client resolves its
  own kart's contacts as they happen, against where each nearby opponent is
  now, and applies its own kart's share. The server finds the same contact
  in both karts' states with the same resolver, resolves it once, and sends
  it to both clients as its one record. A client that already answered it
  does nothing more; one that missed it applies the server's share once,
  while it is still fresh. A response already made stands. Waiting for the
  server instead costs a round trip (both karts' states up, the reply
  down), during which karts sink into each other by closing speed times
  the delay, and a fast head-on passes right through.
- **Contact at the present, not in the past.** Opponents drawn from a jitter
  buffer sit behind their true positions by speed times delay, several kart
  lengths at racing speed, so a contact tested or shown against them is
  wrong. Near the player, estimate each opponent's present pose from its
  newest state, velocity, and angular velocity (dead reckoning), test
  contact against that estimate, and draw it there, blending out each new
  state's error rather than jumping (after Murphy's projective velocity
  blending), fading it exponentially so a state arriving mid-fade carries
  on from what's drawn. Trust the velocity a state reports:
  a push between two states barely shows in the motion between them, so a
  bound by that motion breaks honest contacts.
  Further away, keep drawing in the past for smoothness, easing between the
  two with distance at a bounded rate.
- **Push apart along the shallowest share.** Karts are long and flat, so
  pick the contact normal by the overlap's share of the two boxes' reach,
  not its depth: karts pressed deep end to end still push apart end to end,
  where the least depth would turn up through their shallow height and let
  them pass through.
- **One two-body impulse.** Split the relative velocity at the contact point
  into its normal and contact-plane parts. The normal impulse removes the
  closing speed, plus any restitution, given both karts' mass and their
  inertia about their centres of mass, through each lever arm to the
  contact point, so an off-centre hit spins the karts (Hecker).
  Contact-plane friction is bounded by the normal impulse (Coulomb). Both
  karts take it equal and opposite at the contact point, repeated each step
  while contact lasts: the sequential-impulse method (Catto). Combine the
  two karts' materials with the rule kart-against-course contacts use.
- **Push, never place.** A contact changes only a kart's velocity and spin,
  never its position or heading directly. Overlap, from an estimate
  correcting itself, is removed by a small, capped separating velocity: a
  pose correction can drive a kart into a wall or another kart and eject
  it. The push goes on the kart before its physics step, so the engine's
  own contacts with the course in that step still hold.
- **Carry the other kart's share.** A client applies the other kart's share
  to its estimate of that kart until that kart's own states from after the
  contact arrive. Otherwise the estimate keeps driving into the player for
  its lateness, as if the other kart couldn't be moved. A client that
  applies the server's share of a touch it missed carries the other kart's
  opposite push too, while that kart's states don't yet reach the touch.
- **Sweep the motion.** Test the motion between samples, not only its ends,
  in sub-steps short enough that the closing distance per sub-step is a
  fraction of the smallest kart dimension, for closing speeds up to twice
  top speed (a head-on): on the client each physics step, on the server
  each state interval.
- **Out of touch is see-through.** A kart that can't respond in time
  (paused, hidden, disconnected, finished, or with its states arriving late)
  neither touches nor is touched, and is drawn see-through so passing
  through it reads. So is a kart just reset, or whose own states went
  silent too long (a pause, or a long hitch caught up), until it is clear
  of the others: the server judges a kart's own gaps the same way. Each
  client also judges its own connection from its round trip to the server
  and says so with its states, so a kart whose link is slow either way is
  out of touch to everyone, itself included. A kart goes out of touch and
  comes back at different lateness limits, so a jittery connection doesn't
  flicker. The server applies the same rule and ignores
  resent states for contact.
- **One record per touch.** The server opens one contact per pair at first
  touch and keeps it until they separate. Since clients' answers stop karts
  just touching, it counts karts within the overlap slop as touching, and
  resolves a new touch from the motion it saw bring each kart to it: the
  motion between states may already show the clients' answers. A kart with
  no motion seen yet, or one that turned back into the other, is resolved
  from the motion through it. It sends both clients one message as it
  opens, with an ID, its race time, normal, point, closing speed, and that
  kart's opening impulse. A client matches it to its own answer by the
  pair and a nearby race time; rubbing after the opening is answered by
  each client every step. Later systems, such as damage, attach to the ID
  under a new protocol version.

## Failure Modes

- Waiting for the server's decision: contact feels soft, and fast contacts
  pass through.
- Testing or drawing contact against interpolated, past poses: karts bounce
  off a kart drawn lengths away, or reach one without touching it.
- Infinite-mass (kinematic) stand-ins for opponents: every kart hits like a
  wall, whatever its mass.
- Not carrying the other kart's share: the player is pushed as if the other
  kart couldn't be moved.
- Moving a kart to undo overlap: ejections, especially against walls.
- Contact with a kart that can't respond: a one-sided wall, then a late
  shove when it returns.
- Overlap tests only at sample instants: head-on pass-through.
- Rewinding and re-simulating the player's kart on the server's word:
  costly on a phone, and the kart visibly jumps.

## Known Limits

- The two shares agree to within each client's estimate of the other kart,
  not exactly.
- A client resolving a contact doesn't know the other kart's other
  contacts, so a kart that can't be moved (pinned on a wall, or a scripted
  test racer) lets its pusher sink in gradually.
- Lateness is judged at intervals, so during a brief spike, before both
  sides agree, only one kart may be pushed.
- If both clients miss the same touch, one may push its own kart again
  after the server's share.
- In a chain, a kart knocked into another by a third reaches it before that
  kart's client can know, so it sinks in by about the delay times the
  closing speed (10–20 cm at 2–4 m/s on a quick connection) before the push
  apart parts them.
- A client modified to report a higher velocity can push harder on other
  clients than its kart moves; the server's record, from the motion it
  saw, can't be pushed so.

## Validation

- Pure tests of the resolver: rubbing, glancing, rear-end, head-on up to
  twice top speed, pileup, airborne, off-centre spin, and conserved momentum
  (`tests/kart-contact.spec.ts`).
- Pure tests of the server's one record per touch, in either arrival order,
  with late and resent states, and around resets
  (`tests/room-contacts.spec.ts`).
- Pure tests of the present estimate, the shares it carries, and each
  client's judgment of lateness, its own included
  (`tests/opponent-motion.spec.ts`, `tests/page-contacts.spec.ts`,
  `tests/room-connection.spec.ts`), and clients simulated through the
  server's tracker: a head-on and a rear-end answered at once on both and
  recorded once at their closing speed, a three-kart pileup, a late client
  filled in once, and a kart out of touch passing through.
- A browser test with a scripted opponent and room: the response comes at
  once, nothing passes through, and a missed contact is filled in once
  (`tests/room-race.spec.ts`).
- Two devices: rear-end, side-by-side rubbing, head-on, pinning against a
  wall, and a pileup each read as one contact on both screens.

## Related

- [Multiplayer rooms](../multiplayer-rooms/README.md)
- [Collisions](../collisions/README.md)
- [PlayCanvas and Ammo collisions](../../tools/playcanvas-ammo/collisions/README.md):
  applying impulses to the kart's body.
- [Cloudflare Durable Objects](../../tools/cloudflare-durable-objects/README.md):
  the room server.
- [Multiplayer rooms system](../../project-systems/multiplayer-rooms/README.md)

## Sources

- Glenn Fiedler, Networked Physics in Virtual Reality (each object's state
  comes from the player simulating it, with no rollback or re-simulation):
  <https://developers.meta.com/horizon/blog/networked-physics-in-virtual-reality-networking-a-stack-of-cubes-with-unity-and-physx/>
- Curtiss Murphy, Believable Dead Reckoning for Networked Games, *Game
  Engine Gems 2* (2011), pp. 307–328:
  <https://gameenginegems.com/gemsdb/article.php?id=46>
- Chris Hecker, Physics, Part 3: Collision Response (*Game Developer*,
  February/March 1997), the impulse with rotation:
  <https://www.chrishecker.com/images/e/e7/Gdmphys3.pdf>; and Part 4: The
  Third Dimension (June 1997), its 3D form:
  <https://www.chrishecker.com/images/b/bb/Gdmphys4.pdf>
- Erin Catto, Fast and Simple Physics using Sequential Impulses (GDC 2006):
  <https://box2d.org/files/ErinCatto_SequentialImpulses_GDC2006.pdf>
