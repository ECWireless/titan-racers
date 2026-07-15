type RightingVector = {
  x: number;
  y: number;
  z: number;
};

const AXIS_EPSILON = 1e-6;
const SHORTEST_AXIS_MINIMUM_LENGTH = 0.05;

function isFiniteVector(vector: RightingVector) {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

function normalizeHorizontal(vector: RightingVector): RightingVector | null {
  const length = Math.hypot(vector.x, vector.z);

  if (!Number.isFinite(length) || length <= AXIS_EPSILON) {
    return null;
  }

  return {
    x: vector.x === 0 ? 0 : vector.x / length,
    y: 0,
    z: vector.z === 0 ? 0 : vector.z / length,
  };
}

function getShortestRollAxis(up: RightingVector) {
  const length = Math.hypot(up.x, up.z);

  if (!Number.isFinite(length) || length < SHORTEST_AXIS_MINIMUM_LENGTH) {
    return null;
  }

  return normalizeHorizontal({ x: -up.z, y: 0, z: up.x });
}

export function getManualRightingAxis(
  up: RightingVector,
  forward: RightingVector,
  minimumInversionDegrees: number,
): RightingVector | null {
  if (
    !isFiniteVector(up) ||
    !isFiniteVector(forward) ||
    !Number.isFinite(minimumInversionDegrees)
  ) {
    return null;
  }

  const upLength = Math.hypot(up.x, up.y, up.z);
  if (upLength <= AXIS_EPSILON) {
    return null;
  }

  const normalizedUp = {
    x: up.x / upLength,
    y: up.y / upLength,
    z: up.z / upLength,
  };
  const inversionThreshold = Math.cos(
    minimumInversionDegrees * (Math.PI / 180),
  );

  if (normalizedUp.y > inversionThreshold) {
    return null;
  }

  const shortestRollAxis = getShortestRollAxis(normalizedUp);

  return (
    shortestRollAxis ?? normalizeHorizontal(forward) ?? { x: 0, y: 0, z: 1 }
  );
}

export function getManualRightingTorqueScale(
  up: RightingVector,
  minimumInversionDegrees: number,
  maximumAngledBoost: number,
): number | null {
  if (
    !isFiniteVector(up) ||
    !Number.isFinite(minimumInversionDegrees) ||
    !Number.isFinite(maximumAngledBoost) ||
    maximumAngledBoost < 0
  ) {
    return null;
  }

  const upLength = Math.hypot(up.x, up.y, up.z);
  if (upLength <= AXIS_EPSILON) {
    return null;
  }

  const normalizedUpY = up.y / upLength;
  const inversionThreshold = Math.cos(
    minimumInversionDegrees * (Math.PI / 180),
  );
  const assistRange = 1 + inversionThreshold;
  if (normalizedUpY > inversionThreshold || assistRange <= AXIS_EPSILON) {
    return null;
  }

  const angledRatio = Math.max(
    0,
    Math.min(1, (normalizedUpY + 1) / assistRange),
  );
  return 1 + maximumAngledBoost * angledRatio;
}
