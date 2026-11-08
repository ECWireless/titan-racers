/** A door's build: its leaf's mass, the hit its latch takes, and its hinge's friction. */
export type CourseDoorType = {
  /** The hinge's friction, N·m. */
  hingeFriction: number;
  /** The impulse at which the latch gives, N·s (see course-doors.ts). */
  latchImpulse: number;
  /** The leaf's mass, kg. */
  mass: number;
};

export type CourseDoorTypeReference = { id: string; version: number };

// A published door type version never changes; new values are a new version.
const COURSE_DOOR_TYPES: Readonly<
  Record<string, Readonly<Record<number, CourseDoorType>>>
> = {
  // A hollow steel utility door, 1.0 × 2.1 m and 45 mm thick, on a hinge
  // that turns freely. Its worn latch gives to a 1.85 kg kart hitting it
  // square, low and halfway across its latch side, at about 7.5 m/s: it
  // holds at 6.5 m/s and gives at 8.5 (tests/course-doors.spec.ts).
  "door.worn-steel": {
    1: { hingeFriction: 2, latchImpulse: 10.5, mass: 40 },
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
