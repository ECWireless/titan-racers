import {
  multiplyKartInertiaTensor,
  type KartInertiaTensor,
} from "./kart-principal-axes";

export type RestSettlingVector = {
  x: number;
  y: number;
  z: number;
};

export const KART_REST_SETTLING_POLICY = Object.freeze({
  angularSettleTimeSeconds: 1 / 12,
  maximumAngularSpeed: 1,
  maximumPlanarSpeed: 0.3,
  maximumVerticalSpeed: 0.2,
});

function isFiniteVector(vector: RestSettlingVector) {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

export function isRestSettlingEligible(
  linearVelocity: RestSettlingVector,
  angularVelocity: RestSettlingVector,
  isFullySupported: boolean,
  hasDrivingInput: boolean,
) {
  if (
    !isFiniteVector(linearVelocity) ||
    !isFiniteVector(angularVelocity) ||
    !isFullySupported ||
    hasDrivingInput
  ) {
    return false;
  }

  return (
    Math.hypot(linearVelocity.x, linearVelocity.z) <
      KART_REST_SETTLING_POLICY.maximumPlanarSpeed &&
    Math.abs(linearVelocity.y) <
      KART_REST_SETTLING_POLICY.maximumVerticalSpeed &&
    Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z) <
      KART_REST_SETTLING_POLICY.maximumAngularSpeed
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

export function getRestSettlingLocalTorqueImpulse(
  localAngularVelocity: RestSettlingVector,
  localInertia: KartInertiaTensor,
  deltaSeconds: number,
): RestSettlingVector {
  if (
    !isFiniteVector(localAngularVelocity) ||
    !isFinitePositiveInertia(localInertia) ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  const settleRatio = Math.min(
    deltaSeconds / KART_REST_SETTLING_POLICY.angularSettleTimeSeconds,
    1,
  );

  return multiplyKartInertiaTensor(localInertia, {
    x: -localAngularVelocity.x * settleRatio,
    y: -localAngularVelocity.y * settleRatio,
    z: -localAngularVelocity.z * settleRatio,
  });
}
