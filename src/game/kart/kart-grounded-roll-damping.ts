import {
  multiplyKartInertiaTensor,
  type KartInertiaTensor,
} from "./kart-principal-axes";

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

function isFinitePositiveInertia(tensor: KartInertiaTensor) {
  return (
    Object.values(tensor).every(Number.isFinite) &&
    tensor.xx > 0 &&
    tensor.yy > 0 &&
    tensor.zz > 0
  );
}

export function getGroundedRollDampingLocalTorqueImpulse(
  localAngularVelocity: GroundedRollDampingVector,
  localInertia: KartInertiaTensor,
  supportedWheelCount: number,
  deltaSeconds: number,
): GroundedRollDampingVector {
  if (
    !isFiniteVector(localAngularVelocity) ||
    !isFinitePositiveInertia(localInertia) ||
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

  return multiplyKartInertiaTensor(localInertia, {
    x: 0,
    y: 0,
    z: -localAngularVelocity.z * settleRatio,
  });
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
