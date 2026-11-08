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
- `src/game/course/falls-view-park.v12.json`: door 4, its parts, and the
  store room.

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
- `door.worn-steel@1` is a 40 kg leaf whose latch gives at 10.5 N·s, with
  2 N·m of hinge friction. A Balanced-mass kart hitting it square, low and
  0.75 m from the hinge, breaks the latch between 6.5 and 8.5 m/s at any
  substep count. A push at the Speed kart's 34 N, or a 12 m/s hit 0.1 m
  from the hinge, never does. Little of a hit is left once the latch takes
  its share: a 2 kg kart swings the door only partway, a 17 m/s one to its
  stop, and a kart can push it the rest of the way.
- Door 4 is the north tunnel's, 1.0 × 2.1 m and 45 mm thick, flush with the
  wall's tunnel face. It hangs on its north edge and opens 90° into the
  store room, to rest by the room's north wall. Its handle on each face,
  kick plate, and number ride on it. Its wall is split around the doorway,
  with a lintel above 2.1 m.
- The store room is 2.1 × 3.6 m inside and 2.3 m high, with a concrete
  floor level with the tunnel's, under the berm's slab. Its one work light
  (`tunnel-store-room-light`, the course's 21st indoor lamp) is dark until
  door 4 opens. It leads nowhere, so the run check, gates, and recordings
  are unchanged.
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

## Known Limits

- A ghost drives through a closed door, and an opponent in a room is drawn
  through one until its opening is recorded.
- The room's light, like every course lamp, casts no shadows, so once on it
  also reaches the tunnel's floor just outside the wall.
- The chase camera has little room in the store room and pulls in close.
- One kind of interactable; no damage, and no door that opens a route.

## Related

- [Course interactables standard](../../game-concepts/course-interactables/README.md)
- [Ammo constraints](../../tools/playcanvas-ammo/constraints/README.md)
- [Course data](../course-data/README.md)
- [Collisions](../collisions/README.md)
