export type GroundedRollDampingVector = {
  x: number;
  y: number;
  z: number;
};

export const KART_GROUNDED_ROLL_DAMPING_POLICY = Object.freeze({
  flatSurfaceMinimumNormalY: 0.98,
  heaveSettleTimeSeconds: 0.08,
  minimumSupportedWheels: 2,
  rollSettleTimeSeconds: 0.1,
});

function isFiniteVector(vector: GroundedRollDampingVector) {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

export function getGroundedRollDampingLocalTorqueImpulse(
  localAngularVelocity: GroundedRollDampingVector,
  localInertia: GroundedRollDampingVector,
  supportedWheelCount: number,
  deltaSeconds: number,
): GroundedRollDampingVector {
  if (
    !isFiniteVector(localAngularVelocity) ||
    !isFiniteVector(localInertia) ||
    localInertia.x <= 0 ||
    localInertia.y <= 0 ||
    localInertia.z <= 0 ||
    !Number.isFinite(supportedWheelCount) ||
    supportedWheelCount <
      KART_GROUNDED_ROLL_DAMPING_POLICY.minimumSupportedWheels ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  const settleRatio = Math.min(
    deltaSeconds /
      KART_GROUNDED_ROLL_DAMPING_POLICY.rollSettleTimeSeconds,
    1,
  );

  return {
    x: 0,
    y: 0,
    z: -localInertia.z * localAngularVelocity.z * settleRatio,
  };
}

export function getFlatGroundedHeaveDampingImpulse(
  verticalSpeed: number,
  mass: number,
  supportedWheelCount: number,
  minimumSupportNormalY: number,
  bodyUpY: number,
  deltaSeconds: number,
) {
  if (
    !Number.isFinite(verticalSpeed) ||
    !Number.isFinite(mass) ||
    mass <= 0 ||
    !Number.isFinite(supportedWheelCount) ||
    supportedWheelCount <
      KART_GROUNDED_ROLL_DAMPING_POLICY.minimumSupportedWheels ||
    !Number.isFinite(minimumSupportNormalY) ||
    minimumSupportNormalY <
      KART_GROUNDED_ROLL_DAMPING_POLICY.flatSurfaceMinimumNormalY ||
    !Number.isFinite(bodyUpY) ||
    bodyUpY < KART_GROUNDED_ROLL_DAMPING_POLICY.flatSurfaceMinimumNormalY ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return 0;
  }

  const settleRatio = Math.min(
    deltaSeconds /
      KART_GROUNDED_ROLL_DAMPING_POLICY.heaveSettleTimeSeconds,
    1,
  );

  return -mass * verticalSpeed * settleRatio;
}
