import {
  getApprovedEnclosure,
  getEnclosureFrame,
  type CourseEnclosure,
  type Vector3,
} from "../enclosure/island-three";

/**
 * Apparent forces inside a spinning habitat, in course coordinates, per unit
 * mass. See skills/game-concepts/rotating-habitat-physics for the model.
 */
export type HabitatField = {
  /** Spin rate, rad/s, right-handed about `spinAxis`. */
  readonly spinRate: number;
  /** Unit vector along the spin axis (sunward). */
  readonly spinAxis: Vector3;
  /** The spin as a vector, ω × `spinAxis`, rad/s. */
  readonly spin: Vector3;
  /** Centrifugal gravity at a position: ω² r⊥, away from the axis. */
  gravity(position: Vector3): Vector3;
  /** Coriolis acceleration for a velocity relative to the habitat: −2ω × v. */
  coriolis(velocity: Vector3): Vector3;
  /** Unit up at a position: toward the axis. Course +Y on the axis itself. */
  up(position: Vector3): Vector3;
};

const COURSE_UP: Vector3 = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * The habitat spins so its floor feels `floorGravity`: ω = √(g / R). Gravity
 * then falls linearly to zero on the axis.
 */
export function createHabitatField(
  enclosure: CourseEnclosure,
  floorGravity: number,
): HabitatField {
  const definition = getApprovedEnclosure(enclosure);
  if (!definition) {
    throw new Error("Unsupported enclosure");
  }
  if (!Number.isFinite(floorGravity) || floorGravity < 0) {
    throw new Error("Floor gravity must be a finite non-negative number");
  }
  const frame = getEnclosureFrame(enclosure);
  const { axial, azimuth } = enclosure.placement;
  const axisPoint = frame.point(axial, azimuth, 0);
  const axis = frame.sunward;
  const spinRate = Math.sqrt(floorGravity / definition.radius);
  const spinRateSquared = spinRate * spinRate;

  /** Perpendicular offset from the axis to a position. */
  const radial = (position: Vector3): Vector3 => {
    const dx = position.x - axisPoint.x;
    const dy = position.y - axisPoint.y;
    const dz = position.z - axisPoint.z;
    const along = dx * axis.x + dy * axis.y + dz * axis.z;
    return {
      x: dx - along * axis.x,
      y: dy - along * axis.y,
      z: dz - along * axis.z,
    };
  };

  return Object.freeze({
    coriolis(velocity: Vector3) {
      const scale = -2 * spinRate;
      return {
        x: scale * (axis.y * velocity.z - axis.z * velocity.y),
        y: scale * (axis.z * velocity.x - axis.x * velocity.z),
        z: scale * (axis.x * velocity.y - axis.y * velocity.x),
      };
    },
    gravity(position: Vector3) {
      const offset = radial(position);
      return {
        x: offset.x * spinRateSquared,
        y: offset.y * spinRateSquared,
        z: offset.z * spinRateSquared,
      };
    },
    spin: Object.freeze({
      x: axis.x * spinRate,
      y: axis.y * spinRate,
      z: axis.z * spinRate,
    }),
    spinAxis: Object.freeze({ ...axis }),
    spinRate,
    up(position: Vector3) {
      const offset = radial(position);
      const length = Math.hypot(offset.x, offset.y, offset.z);
      if (length < 1e-9) {
        return { ...COURSE_UP };
      }
      return {
        x: -offset.x / length,
        y: -offset.y / length,
        z: -offset.z / length,
      };
    },
  });
}

/**
 * The shortest rotation turning a unit `up` onto course +Y, as a quaternion.
 * Policies written for a Y-up world run on vectors turned into this level
 * frame, and their results turn back with the inverse.
 */
export function getLevelRotation(up: Vector3) {
  const w = 1 + up.y;
  if (w < 1e-9) {
    return { w: 0, x: 1, y: 0, z: 0 };
  }
  const length = Math.hypot(w, up.z, up.x);
  return { w: w / length, x: -up.z / length, y: 0, z: up.x / length };
}
