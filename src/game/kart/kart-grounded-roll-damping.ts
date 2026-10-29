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
  // Cosines of how far the body (11°) and each contact (1.8°, so planes
  // within 2.4–3.6°, a faceted curve's joins) may turn from the mean support.
  minimumBodySupportAlignment: 0.98,
  minimumContactSupportAlignment: 0.9995,
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

function dot(a: GroundedRollDampingVector, b: GroundedRollDampingVector) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Damps heave relative to the support: velocity along the supported wheels'
 * mean contact normal, which steady driving on any slope leaves at zero.
 * Course surfaces are static, so that velocity is the kart's own. It acts
 * only while the kart sits flush on one plane, or a faceted curve's gentle
 * joins, so ramp toes, lips, kerbs, and tilted landings keep their motion.
 * Takes unit contact normals and returns a world impulse at the center of
 * mass.
 */
export function getGroundedHeaveDampingImpulse(
  linearVelocity: GroundedRollDampingVector,
  contactNormals: readonly GroundedRollDampingVector[],
  bodyUp: GroundedRollDampingVector,
  mass: number,
  deltaSeconds: number,
): GroundedRollDampingVector {
  const none = { x: 0, y: 0, z: 0 };
  const policy = KART_GROUNDED_ROLL_DAMPING_POLICY;
  if (
    !isFiniteVector(linearVelocity) ||
    !isFiniteVector(bodyUp) ||
    !contactNormals.every(isFiniteVector) ||
    contactNormals.length < policy.minimumSupportedWheels ||
    !Number.isFinite(mass) ||
    mass <= 0 ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return none;
  }

  const sum = contactNormals.reduce(
    (total, normal) => ({
      x: total.x + normal.x,
      y: total.y + normal.y,
      z: total.z + normal.z,
    }),
    none,
  );
  const length = Math.hypot(sum.x, sum.y, sum.z);
  if (length === 0) return none;
  const normal = { x: sum.x / length, y: sum.y / length, z: sum.z / length };
  if (
    dot(bodyUp, normal) < policy.minimumBodySupportAlignment ||
    contactNormals.some(
      (contact) => dot(contact, normal) < policy.minimumContactSupportAlignment,
    )
  ) {
    return none;
  }

  const settleRatio = Math.min(deltaSeconds / policy.heaveSettleTimeSeconds, 1);
  const impulse = -mass * dot(linearVelocity, normal) * settleRatio;
  return {
    x: normal.x * impulse,
    y: normal.y * impulse,
    z: normal.z * impulse,
  };
}
