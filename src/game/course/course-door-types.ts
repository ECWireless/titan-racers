/** A door's build: its leaf's mass, the hit its latch takes, and its hinge's friction. */
export type CourseDoorType = {
  /** The hinge's friction, N·m. */
  hingeFriction: number;
  /** The impulse at which the latch gives, N·s (see course-doors.ts). */
  latchImpulse: number;
  /** The leaf's mass, kg. */
  mass: number;
};

type CourseDoorTypeReference = { id: string; version: number };

// A published door type version never changes; new values are a new version.
const COURSE_DOOR_TYPES: Readonly<
  Record<string, Readonly<Record<number, CourseDoorType>>>
> = {
  // A hollow steel utility door, 1.0 × 2.1 m and 45 mm thick, on a hinge
  // that turns freely. Its worn latch gives to a 1.85 kg kart hitting it
  // square and low: at about 4.5 m/s halfway across its latch side, about
  // 6 m/s at its middle, and about 10 m/s beside its hinge, as measured on
  // the vendored Ammo build. A Balanced kart crossing a 4.5 m tunnel from a
  // standstill at its far wall reaches about 7 m/s.
  "door.worn-steel": {
    1: { hingeFriction: 2, latchImpulse: 5.5, mass: 40 },
  },
};

export function getCourseDoorType({
  id,
  version,
}: CourseDoorTypeReference): CourseDoorType | null {
  const versions = Object.hasOwn(COURSE_DOOR_TYPES, id)
    ? COURSE_DOOR_TYPES[id]
    : undefined;
  return versions && Object.hasOwn(versions, version) ? versions[version] : null;
}
