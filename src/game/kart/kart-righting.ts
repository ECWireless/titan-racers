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
  localInertia: RightingVector,
  localAxis: RightingVector,
) {
  if (!isFiniteVector(localInertia) || !isFiniteVector(localAxis)) {
    return 0;
  }

  const axisLength = Math.hypot(localAxis.x, localAxis.y, localAxis.z);
  if (
    axisLength <= AXIS_EPSILON ||
    localInertia.x <= 0 ||
    localInertia.y <= 0 ||
    localInertia.z <= 0
  ) {
    return 0;
  }

  const axisX = localAxis.x / axisLength;
  const axisY = localAxis.y / axisLength;
  const axisZ = localAxis.z / axisLength;

  return (
    localInertia.x * axisX ** 2 +
    localInertia.y * axisY ** 2 +
    localInertia.z * axisZ ** 2
  );
}

export function getManualRightingCaptureLocalTorqueImpulse(
  localInertia: RightingVector,
  localAngularVelocity: RightingVector,
  targetLocalAngularVelocity: RightingVector = { x: 0, y: 0, z: 0 },
): RightingVector {
  if (
    !isFiniteVector(localInertia) ||
    !isFiniteVector(localAngularVelocity) ||
    !isFiniteVector(targetLocalAngularVelocity) ||
    localInertia.x <= 0 ||
    localInertia.y <= 0 ||
    localInertia.z <= 0
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x:
      localInertia.x *
      (targetLocalAngularVelocity.x - localAngularVelocity.x),
    y:
      localInertia.y *
      (targetLocalAngularVelocity.y - localAngularVelocity.y),
    z:
      localInertia.z *
      (targetLocalAngularVelocity.z - localAngularVelocity.z),
  };
}

export function getManualRightingTorqueImpulse(
  localInertia: RightingVector,
  localAxis: RightingVector,
  gravity: number,
  liftClearanceHeight: number,
  torqueScale = 1,
) {
  if (
    !Number.isFinite(gravity) ||
    gravity <= 0 ||
    !Number.isFinite(liftClearanceHeight) ||
    liftClearanceHeight <= 0 ||
    !Number.isFinite(torqueScale) ||
    torqueScale <= 0
  ) {
    return 0;
  }

  const liftSpeed = Math.sqrt(
    2 * gravity * liftClearanceHeight,
  );
  const airborneSeconds = (2 * liftSpeed) / gravity;
  const targetAngularSpeed =
    (KART_MANUAL_RIGHTING_POLICY.targetRotationDegrees * (Math.PI / 180)) /
    airborneSeconds;

  return (
    getAxisMomentOfInertia(localInertia, localAxis) *
    targetAngularSpeed *
    KART_MANUAL_RIGHTING_POLICY.contactTorqueAllowance *
    torqueScale
  );
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
