export type RaceVector3 = {
  x: number;
  y: number;
  z: number;
};

export type RaceQuaternion = {
  w: number;
  x: number;
  y: number;
  z: number;
};

export type DirectedRaceGate = {
  center: RaceVector3;
  forward: RaceVector3;
  halfExtents: RaceVector3;
  id: string;
  worldToLocalRotation: RaceQuaternion;
};

export type GateCrossingOptions = {
  boundsTolerance?: number;
  planeEpsilon?: number;
  /**
   * How far either end of the segment may sit on the wrong side of the gate
   * plane, for positions rounded after the fact (a ghost recording's
   * millimetres). Zero for live race positions.
   */
  planeTolerance?: number;
};

const DEFAULT_BOUNDS_TOLERANCE = 1e-6;
const DEFAULT_PLANE_EPSILON = 1e-6;

function isFiniteVector(vector: RaceVector3) {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

function subtract(left: RaceVector3, right: RaceVector3): RaceVector3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function dot(left: RaceVector3, right: RaceVector3) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function rotateVector(
  rotation: RaceQuaternion,
  vector: RaceVector3,
): RaceVector3 {
  const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);

  return {
    x: vector.x + rotation.w * tx + (rotation.y * tz - rotation.z * ty),
    y: vector.y + rotation.w * ty + (rotation.z * tx - rotation.x * tz),
    z: vector.z + rotation.w * tz + (rotation.x * ty - rotation.y * tx),
  };
}

export function crossesDirectedRaceGate(
  gate: DirectedRaceGate,
  previousPosition: RaceVector3,
  currentPosition: RaceVector3,
  options: GateCrossingOptions = {},
) {
  if (!isFiniteVector(previousPosition) || !isFiniteVector(currentPosition)) {
    return false;
  }

  const planeEpsilon = options.planeEpsilon ?? DEFAULT_PLANE_EPSILON;
  const boundsTolerance = options.boundsTolerance ?? DEFAULT_BOUNDS_TOLERANCE;
  const planeTolerance = options.planeTolerance ?? 0;
  const previousOffset = subtract(previousPosition, gate.center);
  const currentOffset = subtract(currentPosition, gate.center);
  const previousDistance = dot(previousOffset, gate.forward);
  const currentDistance = dot(currentOffset, gate.forward);

  const travel = currentDistance - previousDistance;
  if (
    previousDistance >= planeTolerance - planeEpsilon ||
    currentDistance < -planeTolerance ||
    // Rounding can make a slow crossing's ends coincide, or even reverse.
    travel <= planeEpsilon - 2 * planeTolerance
  ) {
    return false;
  }

  // Without a plane tolerance the fraction is already within (0, 1].
  const intersectionFraction =
    travel > planeEpsilon
      ? Math.min(1, Math.max(0, -previousDistance / travel))
      : 1;

  const intersectionOffset = {
    x:
      previousOffset.x +
      (currentOffset.x - previousOffset.x) * intersectionFraction,
    y:
      previousOffset.y +
      (currentOffset.y - previousOffset.y) * intersectionFraction,
    z:
      previousOffset.z +
      (currentOffset.z - previousOffset.z) * intersectionFraction,
  };
  const localIntersection = rotateVector(
    gate.worldToLocalRotation,
    intersectionOffset,
  );

  return (
    Math.abs(localIntersection.x) <= gate.halfExtents.x + boundsTolerance &&
    Math.abs(localIntersection.y) <= gate.halfExtents.y + boundsTolerance &&
    Math.abs(localIntersection.z) <= gate.halfExtents.z + boundsTolerance
  );
}
