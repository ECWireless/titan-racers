# Course Interactables System

**Maturity:** Candidate (PR 6.9, 2026-11-08).

## Purpose And Scope

How Titan Racers builds course objects that change state during a race, by
the [course interactables standard](../../game-concepts/course-interactables/README.md)
on [Ammo constraints](../../tools/playcanvas-ammo/constraints/README.md).
So far that is one kind, the hung door, and one door, Falls View Park's
door 4. Read it before adding a door, or changing how doors are built,
sound, light, or reset.

## Source Ownership

- `src/game/course/course-door-types.ts`: the versioned door types and
  their values.
- `src/game/course/course-document.ts`: `door` and `attachedTo` (schema
  version twelve; see [course data](../course-data/README.md)).
- `src/game/course/course-doors.ts`: each door's frame from its document
  (`getCourseDoorFrame`), its hinge and latch (`CourseDoorJoint`), and
  `addCourseDoors`, which hangs a built course's doors.
- `src/game/audio/impact-sounds.ts` (`playDoorSound`) and
  `src/game/audio/race-audio.ts` (`playDoor`): the latch's clack and the
  stop's thud.
- `src/components/solo-time-trial-canvas.tsx`: hangs the doors after the
  course and its lamps are built, keeps them out of the static batch, sets
  their hinge friction from each step's substeps, plays their events, and
  closes them on Restart and Race again.
- `src/game/room/room-doors.ts`: when a page applies another's opening;
  `room-rules.ts` keeps each door's first claim, `room-protocol.ts` carries
  the claim (`open`) and the race's openings, and `room-connection.ts`
  resends a claim with the states the room missed (protocol 4).
- `src/game/course/falls-view-park.v12.json`: door 4, its parts, and the
  store room.
- `src/game/course/course-posters.ts` and `posters/lucky-lady.ts`: the
  store room's print of The Lucky Lady.

## Behavior And Invariants

- `addCourseDoors` takes each door the builder made as a static box and
  makes it the leaf of a dynamic body named for the door, carrying its
  attached parts. The body's collider is the authored one, in the solid
  obstacle group with a mask of karts alone, so it swings through its frame
  and walls. It takes no world gravity: it is hung plumb, and world gravity
  is the kart's habitat field.
- The hinge pin runs up the leaf's hinge edge, on the face it opens toward,
  with stops at closed and at `stop`. Its friction is a motor holding zero
  speed. The latch is a point-to-point joint at the free edge's mid-height,
  inset 5 cm, with the type's breaking impulse. Past 1° open the latch has
  given: it is removed, the door's lamp comes on, and the latch clacks. The
  leaf meeting either stop at 0.1 m/s or more thuds. Both sounds fade with
  distance from the kart (full within 3 m).
- `door.worn-steel@1` is a 40 kg leaf whose latch gives at 5.5 N·s, with
  2 N·m of hinge friction. A Balanced-mass kart hitting it square and low
  breaks the latch at about 4.5 m/s 0.75 m from the hinge, 6 m/s at the
  middle, and 10 m/s 0.3 m from the hinge, at any substep count. A push at
  the Speed kart's 34 N, or a 12 m/s hit 0.1 m from the hinge, never does.
  The tunnel is 4.5 m wide: a Balanced kart driven across it from a
  standstill at the far wall reaches about 7 m/s, so a deliberate run
  opens the door, and a glancing touch in the racing line does not. (A
  first calibration, 10.5 N·s, needed 7.5 m/s, which only that best run
  reached.) Little of a hit is left once the latch takes
  its share: a 2 kg kart swings the door only partway, a 17 m/s one to its
  stop, and a kart can push it the rest of the way.
- Door 4 is the north tunnel's, 1.0 × 2.1 m and 45 mm thick, flush with the
  wall's tunnel face. It hangs on its north edge and opens 90° into the
  store room, to rest by the room's north wall. Its handle on each face,
  kick plate, and number ride on it. Its wall is split around the doorway,
  with a lintel above 2.1 m.
- The store room is 2.1 × 3.6 m inside and 2.3 m high, with a concrete
  floor level with the tunnel's, under the berm's slab. Its work light
  (`tunnel-store-room-light`, the course's 21st indoor lamp) is dark until
  door 4 opens; its packing light (a tunnel lamp, the 22nd) is always on,
  as a light left on in a store is, and lights the room clearly. It leads
  nowhere, so the run check, gates, and recordings are unchanged.
- The room is a homesteader's store, at true scale, each thing built from
  its real parts: a steel-framed workbench with a vise, a tray of seed
  packets, and an open ledger on its worktop, and a toolbox, seed trays, and
  paint tins on its lower shelf; a seed-drawer cabinet and tins on the shelf
  above; two slatted apple crates; a 200 L water drum with a hand pump and
  two jerrycans along the tunnel wall; a watering can and a yard broom. No
  solid in it is painted in a road-paint finish (`line`, `hazard`): paint is
  drawn toward the camera, so such a solid's edge-on faces show through the
  wall. Its poster, on a plywood board facing the doorway, is The Lucky
  Lady: the homebuilt sphere that carries a family out to homestead the
  asteroids in G. K. O'Neill's The High Frontier (1976), drawn here as
  Island Three's send-off print. The room's design won a Claude-vs-Codex contest judged by
  the lead.
- In a room (protocol 4), the page whose kart breaks a latch has the door
  open at once and sends `open`: the door, the step's race time, and its
  free edge's speed. The room keeps a race's first claim per door, if the
  claimant is racing and its last accepted state was within 1.5 m of the
  door's closed centre across the ground, and lists the race's openings in
  its snapshot, so a returning page finds them. A claim made while the
  connection is down is resent in order among the missed states, so the
  room checks it against where the kart then was. Every other page swings
  the door at that speed once the opener, as drawn there, reaches the
  claim's race time, so the hit is seen first; an opening 1.5 s past, or
  whose opener isn't drawn, opens at rest on its stop, lamp lit and
  silent. After that each page's door answers only its own kart. A room's
  course carries at most four doors.
- Doors close at a race's start (the course is built closed), on Restart,
  and on Race again (`courseDoors.reset()` in `restartRace`). A kart's own
  reset or recovery leaves them as they are.
- The editor draws a door as its static box, closed; doors have no editor
  control.

## Verification

- `tests/course-doors.spec.ts`: door 4's hinge and latch on the vendored
  Ammo build in Node: a turned door hangs closed, the latch's strength at
  1–8 substeps, a push and a hit near the hinge, the stop, and a reset.
- `tests/course-document.spec.ts`: the schema's door, lamp, and part rules.
- `tests/home.spec.ts` ("opens tunnel door 4 to a hard hit"): a kart driven
  into door 4 in a race opens it and lights the store room.
- `tests/room-rules.spec.ts` ("room doors"), `tests/room-doors.spec.ts`,
  `tests/room-connection.spec.ts`, and `tests/course-doors.spec.ts`: the
  room's first plausible claim, when a page applies another's, a claim's
  resend, and a remote swing and rest on real Ammo.
- `tests/room-race.spec.ts` (the two door tests): a page's kart opens door
  4 and the room keeps it; a rival's opening swings the page's door with
  its clack.

## Known Limits

- A ghost drives through a closed door, and an opponent in a room is drawn
  through one until its opening is recorded.
- The room's lights, like every course lamp, cast no shadows, so they also
  reach the tunnel's floor just outside the wall. The tunnel's own lamp
  there hides it.
- The chase camera has little room in the store room and pulls in close.
- One kind of interactable; no damage, and no door that opens a route.

## Related

- [Course interactables standard](../../game-concepts/course-interactables/README.md)
- [Ammo constraints](../../tools/playcanvas-ammo/constraints/README.md)
- [Course data](../course-data/README.md)
- [Collisions](../collisions/README.md)
