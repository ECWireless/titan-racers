import {
  getKartAxisMomentOfInertia,
  multiplyKartInertiaTensor,
  type KartInertiaTensor,
} from "./kart-principal-axes";

type RightingVector = {
  x: number;
  y: number;
  z: number;
};

export const KART_MANUAL_RIGHTING_POLICY = Object.freeze({
  angledTorqueBoost: 2.4,
  captureMinimumUpY: 0.7,
  contactTorqueAllowance: 1.15,
  cooldownSeconds: 0.45,
  liftClearanceToKartLengthRatio: 0.32 / 1.85,
  minimumInversionDegrees: 120,
  supportProbeDistanceToKartLengthRatio: 1.1 / 1.85,
  supportProbeStartToKartLengthRatio: 0.2 / 1.85,
  uprightSettlingMaximumSeconds: 3.5,
  uprightSettlingSeconds: 0.18,
  targetRotationDegrees: 180,
});

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
  minimumInversionDegrees: number =
    KART_MANUAL_RIGHTING_POLICY.minimumInversionDegrees,
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
  minimumInversionDegrees: number =
    KART_MANUAL_RIGHTING_POLICY.minimumInversionDegrees,
  maximumAngledBoost: number = KART_MANUAL_RIGHTING_POLICY.angledTorqueBoost,
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

export function getAxisMomentOfInertia(
  localInertia: KartInertiaTensor,
  localAxis: RightingVector,
) {
  if (
    !Object.values(localInertia).every(Number.isFinite) ||
    !isFiniteVector(localAxis)
  ) {
    return 0;
  }

  const axisLength = Math.hypot(localAxis.x, localAxis.y, localAxis.z);
  if (
    axisLength <= AXIS_EPSILON ||
    localInertia.xx <= 0 ||
    localInertia.yy <= 0 ||
    localInertia.zz <= 0
  ) {
    return 0;
  }

  return getKartAxisMomentOfInertia(localInertia, localAxis);
}

export function getManualRightingCaptureLocalTorqueImpulse(
  localInertia: KartInertiaTensor,
  localAngularVelocity: RightingVector,
  targetLocalAngularVelocity: RightingVector = { x: 0, y: 0, z: 0 },
): RightingVector {
  if (
    !Object.values(localInertia).every(Number.isFinite) ||
    !isFiniteVector(localAngularVelocity) ||
    !isFiniteVector(targetLocalAngularVelocity) ||
    localInertia.xx <= 0 ||
    localInertia.yy <= 0 ||
    localInertia.zz <= 0
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  return multiplyKartInertiaTensor(localInertia, {
    x: targetLocalAngularVelocity.x - localAngularVelocity.x,
    y: targetLocalAngularVelocity.y - localAngularVelocity.y,
    z: targetLocalAngularVelocity.z - localAngularVelocity.z,
  });
}

export function getManualRightingLocalTorqueImpulse(
  localInertia: KartInertiaTensor,
  localAxis: RightingVector,
  gravity: number,
  liftClearanceHeight: number,
  torqueScale = 1,
) {
  if (
    !Object.values(localInertia).every(Number.isFinite) ||
    localInertia.xx <= 0 ||
    localInertia.yy <= 0 ||
    localInertia.zz <= 0 ||
    !Number.isFinite(gravity) ||
    gravity <= 0 ||
    !Number.isFinite(liftClearanceHeight) ||
    liftClearanceHeight <= 0 ||
    !Number.isFinite(torqueScale) ||
    torqueScale <= 0
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  const axisLength = Math.hypot(localAxis.x, localAxis.y, localAxis.z);
  if (!isFiniteVector(localAxis) || axisLength <= AXIS_EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  const liftSpeed = Math.sqrt(
    2 * gravity * liftClearanceHeight,
  );
  const airborneSeconds = (2 * liftSpeed) / gravity;
  const targetAngularSpeed =
    (KART_MANUAL_RIGHTING_POLICY.targetRotationDegrees * (Math.PI / 180)) /
    airborneSeconds;
  const angularSpeed =
    targetAngularSpeed *
    KART_MANUAL_RIGHTING_POLICY.contactTorqueAllowance *
    torqueScale;

  return multiplyKartInertiaTensor(localInertia, {
    x: (localAxis.x / axisLength) * angularSpeed,
    y: (localAxis.y / axisLength) * angularSpeed,
    z: (localAxis.z / axisLength) * angularSpeed,
  });
}

export function getManualRightingLiftImpulse(
  mass: number,
  gravity: number,
  liftClearanceHeight: number,
) {
  if (
    !Number.isFinite(mass) ||
    !Number.isFinite(gravity) ||
    !Number.isFinite(liftClearanceHeight) ||
    mass <= 0 ||
    gravity <= 0 ||
    liftClearanceHeight <= 0
  ) {
    return 0;
  }

  const liftSpeed = Math.sqrt(
    2 * gravity * liftClearanceHeight,
  );

  return mass * liftSpeed;
}

const PIVOT_ROLL_RADIANS = (20 * Math.PI) / 180;

// Lift the center of mass needs so the collision hull clears the support it
// rests on throughout the roll, not just at the top of the hop. In time
// scaled to the flight, height follows 4h(τ − τ²) and the roll angle is
// π·k·τ for every lift h, where k is the roll speed relative to a half turn
// per flight; so each hull point's dip sets a lower bound on h. The first 20°
// is exempt: an edge dipping then only pivots the kart up off its support.
// Hull points are center-of-mass-relative; axis and up share the hull's frame.
export function getManualRightingHullLiftClearance(
  hullPoints: readonly RightingVector[],
  localAxis: RightingVector,
  localUp: RightingVector,
  rollSpeedRatio: number,
) {
  const axisLength = Math.hypot(localAxis.x, localAxis.y, localAxis.z);
  const upLength = Math.hypot(localUp.x, localUp.y, localUp.z);
  if (
    !isFiniteVector(localAxis) ||
    !isFiniteVector(localUp) ||
    axisLength <= AXIS_EPSILON ||
    upLength <= AXIS_EPSILON ||
    !Number.isFinite(rollSpeedRatio) ||
    rollSpeedRatio <= 0
  ) {
    return 0;
  }

  const axis = {
    x: localAxis.x / axisLength,
    y: localAxis.y / axisLength,
    z: localAxis.z / axisLength,
  };
  const up = {
    x: localUp.x / upLength,
    y: localUp.y / upLength,
    z: localUp.z / upLength,
  };
  const points = hullPoints.filter(isFiniteVector);
  const restingDepth = Math.max(
    0,
    ...points.map((point) => -(point.x * up.x + point.y * up.y + point.z * up.z)),
  );
  // Each point's height above the support after rolling by an angle
  // (Rodrigues' rotation projected onto up), relative to the resting COM.
  const heightAfterRoll = (point: RightingVector, angle: number) => {
    const along = point.x * axis.x + point.y * axis.y + point.z * axis.z;
    const cross = {
      x: axis.y * point.z - axis.z * point.y,
      y: axis.z * point.x - axis.x * point.z,
      z: axis.x * point.y - axis.y * point.x,
    };
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return (
      (point.x * cosine + cross.x * sine + axis.x * along * (1 - cosine)) *
        up.x +
      (point.y * cosine + cross.y * sine + axis.y * along * (1 - cosine)) *
        up.y +
      (point.z * cosine + cross.z * sine + axis.z * along * (1 - cosine)) *
        up.z +
      restingDepth
    );
  };

  const rollEnd = Math.min(1, 1 / rollSpeedRatio);
  const samples = 180;
  let clearance = 0;
  for (let sample = 1; sample <= samples; sample += 1) {
    const flightTime = (rollEnd * sample) / samples;
    const rise = 4 * (flightTime - flightTime ** 2);
    if (rise <= 0) {
      continue;
    }
    const angle = Math.PI * rollSpeedRatio * flightTime;
    if (angle < PIVOT_ROLL_RADIANS) {
      continue;
    }
    for (const point of points) {
      clearance = Math.max(clearance, -heightAfterRoll(point, angle) / rise);
    }
  }
  return clearance;
}

export function getManualRightingGeometry(kartLength: number) {
  const boundedLength =
    Number.isFinite(kartLength) && kartLength > 0 ? kartLength : 0;

  return {
    liftClearanceHeight:
      boundedLength *
      KART_MANUAL_RIGHTING_POLICY.liftClearanceToKartLengthRatio,
    supportProbeDistance:
      boundedLength *
      KART_MANUAL_RIGHTING_POLICY.supportProbeDistanceToKartLengthRatio,
    supportProbeStart:
      boundedLength *
      KART_MANUAL_RIGHTING_POLICY.supportProbeStartToKartLengthRatio,
  };
}
