import { REFERENCE_KART_CONSTRUCTION } from "../kart/kart-reference-construction";

export type KartBodyContactMaterial = {
  friction: number;
  restitution: number;
};

export type KartCollisionEnvelope = {
  smallestRelevantCrossSection: number;
};

export type KartCollisionConstruction = {
  bodyContactMaterial: KartBodyContactMaterial;
  envelope: KartCollisionEnvelope;
};

export type KartCollisionSolverPolicy = {
  angularDamping: number;
  ccdMotionThresholdToRadiusRatio: number;
  ccdSweptRadiusToCrossSectionRatio: number;
};

export const DEFAULT_KART_COLLISION_CONSTRUCTION: KartCollisionConstruction = {
  bodyContactMaterial: {
    friction: 0.12,
    restitution: 0.04,
  },
  // Reference-fixture default. Raced karts use the cross-section derived from
  // their solid parts (resolved snapshot geometry).
  envelope: {
    smallestRelevantCrossSection:
      REFERENCE_KART_CONSTRUCTION.collision.smallestRelevantCrossSection,
  },
};

export const KART_COLLISION_SOLVER_POLICY: KartCollisionSolverPolicy = {
  angularDamping: 0.08,
  ccdMotionThresholdToRadiusRatio: 0.75,
  ccdSweptRadiusToCrossSectionRatio: 0.5,
};

export function deriveKartCcdConfiguration(
  envelope: KartCollisionEnvelope,
  policy: KartCollisionSolverPolicy = KART_COLLISION_SOLVER_POLICY,
) {
  if (
    !Number.isFinite(envelope.smallestRelevantCrossSection) ||
    envelope.smallestRelevantCrossSection <= 0 ||
    !Number.isFinite(policy.ccdSweptRadiusToCrossSectionRatio) ||
    policy.ccdSweptRadiusToCrossSectionRatio <= 0 ||
    !Number.isFinite(policy.ccdMotionThresholdToRadiusRatio) ||
    policy.ccdMotionThresholdToRadiusRatio < 0
  ) {
    throw new Error(
      "Kart CCD derivation requires a positive cross-section and radius ratio plus a non-negative threshold ratio",
    );
  }

  const sweptSphereRadius =
    envelope.smallestRelevantCrossSection *
    policy.ccdSweptRadiusToCrossSectionRatio;

  return {
    motionThreshold:
      sweptSphereRadius * policy.ccdMotionThresholdToRadiusRatio,
    sweptSphereRadius,
  };
}

// Bullet only sweeps a sphere around the body center, so it cannot stop a
// leading face from tunnelling through a thin wall. Fast steps are split into
// internal substeps so no kart point travels farther than this per substep
// (half the thinnest 0.1 m solid obstacle). Power-of-two counts divide the
// float32 fixed step exactly, leaving Bullet no interpolation remainder.
export const KART_SUBSTEP_POLICY = {
  maximumPointTravelPerSubstep: 0.05,
  maximumSubsteps: 8,
} as const;

export function selectKartPhysicsSubsteps(motion: {
  angularSpeed: number;
  linearSpeed: number;
  reach: number;
  stepSeconds: number;
}) {
  const policy = KART_SUBSTEP_POLICY;
  const travel =
    (motion.linearSpeed + motion.angularSpeed * motion.reach) *
    motion.stepSeconds;
  if (!Number.isFinite(travel)) {
    return policy.maximumSubsteps;
  }

  let substeps = 1;
  while (
    substeps < policy.maximumSubsteps &&
    travel > policy.maximumPointTravelPerSubstep * substeps
  ) {
    substeps *= 2;
  }
  return substeps;
}
